import { catalogRowsForStocks, eq, firestoreString, jsonResponse, prepareIdempotency, query, readJsonBody, saveIdempotency, setCatalogAvailability } from "../api";
import { assertInventoryValid, defaultOpeningHours, isPlainObject, localWeekday, reservationAvailability, requirePositiveInteger, requireString, validatePickupWindow } from "../domain";
import { createClientSessionToken, getClientIdentity, hashClientSessionToken, hashCustomerPhone, maskPhone, normalizeName, normalizePhone, rateLimit } from "../security";
import type { FirestoreDocument, JsonObject, RequestContext } from "../types";
import { HttpError } from "../types";

const SESSION_TTL_DAYS = 30;
const ACTIVE_RESERVATION_STATUSES = ["ATIVA", "PARCIALMENTE_RETIRADA"];
const ACTIVE_ITEM_STATUSES = ["RESERVADO", "RETIRADA_INFORMADA"];

function validDocumentId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function itemQuery(reservationId: string): JsonObject {
  return query("itensReserva", [eq("reservaId", firestoreString(reservationId))], 100, [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }]);
}

async function makeClientPageCursor(ctx: RequestContext, date: string, id: string): Promise<string> {
  const signature = await hashClientSessionToken(ctx.env, `client-reservation-cursor:v1:${date}:${id}`);
  const bytes = new TextEncoder().encode(JSON.stringify({ date, id, signature }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readClientPageCursor(ctx: RequestContext, value: string | null): Promise<{ date: string; id: string } | null> {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const parsed = JSON.parse(atob(base64)) as { date?: unknown; id?: unknown; signature?: unknown };
    if (typeof parsed.date !== "string" || typeof parsed.id !== "string" || typeof parsed.signature !== "string" || !validDocumentId(parsed.id) ||
        parsed.signature !== await hashClientSessionToken(ctx.env, `client-reservation-cursor:v1:${parsed.date}:${parsed.id}`)) {
      throw new Error("Invalid signed cursor.");
    }
    return { date: parsed.date, id: parsed.id };
  } catch {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
}

function publicReservation(document: FirestoreDocument, items: FirestoreDocument[]): JsonObject {
  const grouped = new Map<string, FirestoreDocument[]>();
  for (const item of items) {
    const key = String(item.data.itemReparteId ?? item.id);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return {
    id: document.id,
    status: document.data.status,
    createdAt: document.data.criadaEm,
    desiredDate: document.data.dataRetiradaPretendida,
    desiredTime: document.data.horarioAproximado ?? null,
    expiresAt: document.data.expiraEm,
    pickupIntent: document.data.intencaoRetirada ?? "SEM_RESPOSTA",
    items: [...grouped.values()].map((rows) => {
      const open = rows.find((item) => ACTIVE_ITEM_STATUSES.includes(String(item.data.status)));
      const representative = open ?? rows[0];
      const withdrawn = rows.filter((item) => item.data.status === "RETIRADO");
      const quantityWithdrawn = withdrawn.reduce((sum, item) => sum + Number(item.data.quantidade ?? 0), 0);
      const requested = Math.max(
        ...rows.map((item) => Number(item.data.quantidadeOriginal ?? 0)),
        quantityWithdrawn + Number(open?.data.quantidade ?? 0),
      );
      return {
        id: open?.id ?? representative.id,
        itemReparteId: representative.data.itemReparteId,
        productId: representative.data.produtoId,
        title: representative.data.tituloSnapshot ?? "",
        volume: representative.data.volumeSnapshot ?? null,
        quantity: requested,
        quantityWithdrawn,
        price: representative.data.precoUnitarioSnapshot ?? null,
        status: open ? open.data.status : quantityWithdrawn >= requested ? "RETIRADO" : representative.data.status,
      };
    }),
  };
}

function reservationPublicStatus(items: FirestoreDocument[]): string {
  const active = items.some((item) => ACTIVE_ITEM_STATUSES.includes(String(item.data.status)));
  const withdrawn = items.some((item) => item.data.status === "RETIRADO");
  return active && withdrawn ? "PARCIALMENTE_RETIRADA" : active ? "ATIVA" : withdrawn ? "CONCLUIDA" : "CANCELADA";
}

function normalizeReservationItems(value: unknown): Array<{ itemReparteId: string; quantity: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpError({ code: "invalid_items", message: "items must contain 1 to 20 products.", status: 400 });
  }
  const aggregated = new Map<string, number>();
  for (const entry of value) {
    if (!isPlainObject(entry)) throw new HttpError({ code: "invalid_items", message: "Each item must be an object.", status: 400 });
    const itemReparteId = requireString(entry.itemReparteId, "itemReparteId", 128);
    if (!validDocumentId(itemReparteId)) throw new HttpError({ code: "invalid_items", message: "itemReparteId is invalid.", status: 400 });
    const quantity = requirePositiveInteger(entry.quantity, "quantity", 50);
    aggregated.set(itemReparteId, (aggregated.get(itemReparteId) ?? 0) + quantity);
  }
  if ([...aggregated.values()].some((quantity) => quantity > 50)) throw new HttpError({ code: "invalid_items", message: "The requested quantity exceeds the allowed limit.", status: 400 });
  return [...aggregated].map(([itemReparteId, quantity]) => ({ itemReparteId, quantity }));
}

async function createSession(ctx: RequestContext): Promise<Response> {
  await rateLimit(ctx, "client-session");
  const body = await readJsonBody(ctx.request, 8_000);
  const name = requireString(body.name, "name", 80);
  const phone = normalizePhone(requireString(body.phone, "phone", 32));
  const nameNormalized = normalizeName(name);
  if (nameNormalized.length < 2 || phone.length < 10 || phone.length > 13) {
    throw new HttpError({ code: "identity_not_found", message: "No profile matched those details.", status: 404 });
  }
  const bank = await ctx.db.get(`bancas/${ctx.env.BANCA_ID}`);
  if (!bank || bank.data.ativo === false) throw new HttpError({ code: "bank_not_found", message: "The bank is not available.", status: 404 });

  const phoneIndexId = await hashCustomerPhone(ctx.env, phone);
  const token = createClientSessionToken();
  const tokenHash = await hashClientSessionToken(ctx.env, token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
  const result = await ctx.db.transact(async (transaction) => {
    const phoneIndex = await transaction.get(`indiceTelefonesClientes/${phoneIndexId}`);
    let clientId = String(phoneIndex?.data.clienteId ?? "");
    let client: JsonObject;
    if (phoneIndex) {
      const existing = await transaction.get(`clientes/${clientId}`);
      if (!existing || existing.data.ativo !== true || existing.data.bancaId !== ctx.env.BANCA_ID || existing.data.nomeNormalizado !== nameNormalized) {
        throw new HttpError({ code: "identity_not_found", message: "No profile matched those details.", status: 404 });
      }
      client = existing.data;
    } else {
      clientId = crypto.randomUUID();
      client = {
        bancaId: ctx.env.BANCA_ID,
        nome: name,
        nomeNormalizado: nameNormalized,
        telefone: phone,
        telefoneNormalizado: phone,
        telefoneFinal: phone.slice(-4),
        telefoneHash: phoneIndexId,
        criadoEm: now.toISOString(),
        atualizadoEm: now.toISOString(),
        ativo: true,
      };
      transaction.set(`clientes/${clientId}`, client, { mustNotExist: true });
      transaction.set(`indiceTelefonesClientes/${phoneIndexId}`, { bancaId: ctx.env.BANCA_ID, clienteId: clientId, criadoEm: now.toISOString() }, { mustNotExist: true });
    }
    const session = {
      bancaId: ctx.env.BANCA_ID,
      clienteId: clientId,
      criadoEm: now.toISOString(),
      ultimoAcesso: now.toISOString(),
      expiraEm: expiresAt.toISOString(),
      ativa: true,
    };
    transaction.set(`sessoesClientes/${tokenHash}`, session, { mustNotExist: true });
    return { clientId, client: client ?? {} };
  });
  return jsonResponse(ctx, {
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
    profile: { id: result.clientId, name: result.client.nome ?? name, maskedPhone: maskPhone(String(result.client.telefone ?? phone)) },
  }, 201);
}

async function createReservation(ctx: RequestContext): Promise<Response> {
  await rateLimit(ctx, "client-write");
  const body = await readJsonBody(ctx.request, 16_000);
  const requestedItems = normalizeReservationItems(body.items);
  const desiredDate = requireString(body.desiredDate, "desiredDate", 10);
  const desiredTime = typeof body.desiredTime === "string" && body.desiredTime.trim() ? body.desiredTime.trim() : undefined;
  if (desiredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(desiredTime)) throw new HttpError({ code: "invalid_pickup_time", message: "desiredTime must use HH:mm.", status: 400 });
  const identity = await getClientIdentity(ctx);
  const now = new Date();
  const reservationId = crypto.randomUUID();
  const idemBody = { clientId: identity.clientId, items: requestedItems, desiredDate, desiredTime: desiredTime ?? null };

  const result = await ctx.db.transact(async (transaction) => {
    const idempotency = await prepareIdempotency(ctx, transaction, `reservation-create:${identity.clientId}`, idemBody);
    if (idempotency.replay !== undefined) return idempotency.replay as JsonObject;

    const bankDocument = await transaction.get(`bancas/${ctx.env.BANCA_ID}`);
    if (!bankDocument || bankDocument.data.ativo === false) throw new HttpError({ code: "bank_not_found", message: "The bank is not available.", status: 404 });
    const weekday = localWeekday(desiredDate);
    const weekdayName = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][weekday];
    const schedules = await transaction.query(`bancas/${ctx.env.BANCA_ID}/horarios`, query("horarios", [], 7));
    const schedule = schedules.find((entry) => Number(entry.data.diaSemana) === weekday || normalizeName(String(entry.data.diaSemana ?? "")) === weekdayName)?.data ?? defaultOpeningHours(weekday);

    const inventoryById = new Map<string, FirestoreDocument>();
    const reparteIds = new Set<string>();
    for (const requested of requestedItems) {
      const item = await transaction.get(`itensReparte/${requested.itemReparteId}`);
      if (!item || item.data.bancaId !== ctx.env.BANCA_ID || !item.data.reparteId) {
        throw new HttpError({ code: "item_unavailable", message: "One or more selected items are no longer available.", status: 409 });
      }
      inventoryById.set(requested.itemReparteId, item);
      reparteIds.add(String(item.data.reparteId));
    }
    const reparteById = new Map<string, FirestoreDocument>();
    for (const reparteId of reparteIds) {
      const reparte = await transaction.get(`repartes/${reparteId}`);
      if (!reparte || reparte.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "item_unavailable", message: "One or more selected items are no longer available.", status: 409 });
      reparteById.set(reparteId, reparte);
    }

    const catalogRowByStock = new Map<string, FirestoreDocument>();
    const publishedLists = new Map<string, boolean>();
    for (const requested of requestedItems) {
      const rows = await transaction.query("itensLista", query("itensLista", [
        eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
        eq("itemReparteId", firestoreString(requested.itemReparteId)),
        eq("ativo", { booleanValue: true }),
      ], 10));
      let publishedRow: FirestoreDocument | undefined;
      for (const row of rows) {
        const listId = String(row.data.listaId ?? "");
        if (!listId) continue;
        if (!publishedLists.has(listId)) {
          const list = await transaction.get(`listas/${listId}`);
          publishedLists.set(listId, Boolean(list && list.data.bancaId === ctx.env.BANCA_ID && list.data.status === "PUBLICADA"));
        }
        if (publishedLists.get(listId)) {
          publishedRow = row;
          break;
        }
      }
      if (!publishedRow) throw new HttpError({ code: "item_unavailable", message: "One or more selected items are no longer published.", status: 409 });
      catalogRowByStock.set(requested.itemReparteId, publishedRow);
    }

    const cutoffs: Array<Date | null> = [];
    for (const item of inventoryById.values()) {
      const reparte = reparteById.get(String(item.data.reparteId));
      if (!reparte || reparte.data.status !== "ATIVO") throw new HttpError({ code: "reservations_closed", message: "One or more selected items are no longer available for reservation.", status: 409 });
      if (item.data.publicadoEm == null || !["DISPONIVEL", "ATIVO", "PUBLICADO", "ESGOTADO"].includes(String(item.data.status ?? ""))) {
        throw new HttpError({ code: "item_unavailable", message: "One or more selected items are no longer available.", status: 409 });
      }
      let cutoffValue = item.data.dataFimReservas ?? reparte.data.dataFimReservas;
      const recolhimento = item.data.dataRecolhimentoOverride ?? reparte.data.dataRecolhimentoPrevista;
      if (!cutoffValue && recolhimento) {
        const recolhimentoDate = new Date(String(recolhimento));
        const safetyDays = Number(item.data.margemSegurancaDias ?? reparte.data.margemSegurancaDias ?? 2);
        if (!Number.isNaN(recolhimentoDate.getTime())) recolhimentoDate.setUTCDate(recolhimentoDate.getUTCDate() - (Number.isInteger(safetyDays) ? safetyDays : 2));
        cutoffValue = Number.isNaN(recolhimentoDate.getTime()) ? null : recolhimentoDate.toISOString();
      }
      const cutoff = typeof cutoffValue === "string" ? new Date(cutoffValue) : null;
      cutoffs.push(cutoff && !Number.isNaN(cutoff.getTime()) ? cutoff : null);
    }
    const pickup = validatePickupWindow({
      now,
      desiredDate,
      desiredTime,
      schedule,
      bank: bankDocument.data,
      reservationCutoffs: cutoffs,
    });

    const itemReservationIds: string[] = [];
    const catalogRows = await catalogRowsForStocks(transaction, ctx.env, requestedItems.map((item) => item.itemReparteId));
    const updatedAvailability = new Map<string, number>();
    for (const requested of requestedItems) {
      const item = inventoryById.get(requested.itemReparteId)!;
      const catalogRow = catalogRowByStock.get(requested.itemReparteId)!;
      assertInventoryValid(item.data);
      if (reservationAvailability(item.data) < requested.quantity) throw new HttpError({ code: "insufficient_stock", message: "One or more selected items no longer have enough stock.", status: 409 });
      const itemReservationId = crypto.randomUUID();
      itemReservationIds.push(itemReservationId);
      const updatedInventory = {
        ...item.data,
        quantidadeReservada: Number(item.data.quantidadeReservada ?? 0) + requested.quantity,
        atualizadoEm: now.toISOString(),
      };
      const movementId = crypto.randomUUID();
      const movement = {
        bancaId: ctx.env.BANCA_ID,
        itemReparteId: requested.itemReparteId,
        itemReservaId: itemReservationId,
        tipo: "RESERVA",
        quantidade: requested.quantity,
        saldoAntes: reservationAvailability(item.data),
        saldoDepois: reservationAvailability(updatedInventory),
        motivo: "Reserva de cliente",
        criadoEm: now.toISOString(),
        usuarioId: null,
      };
      transaction.set(`itensReparte/${requested.itemReparteId}`, updatedInventory);
      updatedAvailability.set(requested.itemReparteId, reservationAvailability(updatedInventory));
      transaction.set(`itensReserva/${itemReservationId}`, {
        reservaId: reservationId,
        bancaId: ctx.env.BANCA_ID,
        itemReparteId: requested.itemReparteId,
        produtoId: item.data.produtoId ?? null,
        tituloSnapshot: catalogRow.data.tituloExibicao ?? item.data.tituloSnapshot ?? null,
        volumeSnapshot: catalogRow.data.volumeExibicao ?? item.data.volumeSnapshot ?? null,
        quantidade: requested.quantity,
        quantidadeOriginal: requested.quantity,
        precoUnitarioSnapshot: catalogRow.data.precoExibicao ?? item.data.precoVenda ?? null,
        status: "RESERVADO",
        criadoEm: now.toISOString(),
      }, { mustNotExist: true });
      transaction.set(`movimentacoesEstoque/${movementId}`, movement, { mustNotExist: true });
    }
    setCatalogAvailability(transaction, catalogRows, updatedAvailability, now.toISOString());
    const reservation = {
      bancaId: ctx.env.BANCA_ID,
      clienteId: identity.clientId,
      clienteNomeSnapshot: identity.client.nome ?? "",
      clienteTelefoneFinal: String(identity.client.telefoneFinal ?? "").slice(-4),
      criadaEm: now.toISOString(),
      dataRetiradaPretendida: pickup.pickupAt.toISOString(),
      horarioAproximado: desiredTime ?? null,
      expiraEm: pickup.expiresAt.toISOString(),
      status: "ATIVA",
      intencaoRetirada: "SEM_RESPOSTA",
      lembreteMeioEnviado: false,
      lembreteDiaEnviado: false,
      lembreteFechamentoEnviado: false,
      atualizadaEm: now.toISOString(),
    };
    const response = { reservationId, status: "ATIVA", expiresAt: pickup.expiresAt.toISOString(), desiredDate: pickup.pickupAt.toISOString(), itemReservationIds };
    transaction.set(`reservas/${reservationId}`, reservation, { mustNotExist: true });
    saveIdempotency(transaction, idempotency, response);
    return response;
  });
  return jsonResponse(ctx, result, 201);
}

async function listReservations(ctx: RequestContext): Promise<Response> {
  const identity = await getClientIdentity(ctx);
  const cursor = await readClientPageCursor(ctx, ctx.url.searchParams.get("cursor"));
  const orderBy = [{ field: { fieldPath: "criadaEm" }, direction: "DESCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }];
  const startAt = cursor ? { values: [firestoreString(cursor.date), { referenceValue: `projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/reservas/${cursor.id}` }], before: false } : undefined;
  const documents = await ctx.db.query("reservas", query("reservas", [
    eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
    eq("clienteId", firestoreString(identity.clientId)),
  ], 31, orderBy, startAt));
  const visible = documents.slice(0, 30);
  const allItems: FirestoreDocument[] = [];
  for (const reservation of visible) allItems.push(...await ctx.db.query("itensReserva", itemQuery(reservation.id)));
  const grouped = new Map<string, FirestoreDocument[]>();
  for (const item of allItems) grouped.set(String(item.data.reservaId), [...(grouped.get(String(item.data.reservaId)) ?? []), item]);
  return jsonResponse(ctx, {
    reservations: visible.map((document) => publicReservation(document, grouped.get(document.id) ?? [])),
    page: { limit: 30, nextCursor: documents.length > 30 && visible.at(-1) ? await makeClientPageCursor(ctx, String(visible.at(-1)!.data.criadaEm), visible.at(-1)!.id) : null },
  });
}

async function listNotifications(ctx: RequestContext): Promise<Response> {
  const identity = await getClientIdentity(ctx);
  const limit = 30;
  const documents = await ctx.db.query("notificacoes", query("notificacoes", [
    eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
    eq("clienteId", firestoreString(identity.clientId)),
    eq("destinatarioTipo", firestoreString("CLIENTE")),
    eq("status", firestoreString("ENVIADA")),
  ], limit + 1, [{ field: { fieldPath: "criadaEm" }, direction: "DESCENDING" }]));
  const visible = documents.slice(0, limit);
  return jsonResponse(ctx, {
    notifications: visible.map((item) => ({
      id: item.id,
      titulo: String(item.data.titulo ?? "Aviso"),
      mensagem: String(item.data.mensagem ?? ""),
      criadaEm: item.data.criadaEm ?? item.data.enviadaEm ?? null,
      lida: item.data.lida === true,
      tipo: String(item.data.tipo ?? "AVISO"),
    })),
    page: { limit, nextCursor: null },
  });
}

async function cancelReservation(ctx: RequestContext, reservationId: string): Promise<Response> {
  await rateLimit(ctx, "client-write");
  if (!validDocumentId(reservationId)) throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
  const identity = await getClientIdentity(ctx);
  const body = await readJsonBody(ctx.request, 4_000);
  const now = new Date();
  const response = await ctx.db.transact(async (transaction) => {
    const idempotency = await prepareIdempotency(ctx, transaction, `reservation-cancel:${identity.clientId}:${reservationId}`, body);
    if (idempotency.replay !== undefined) return idempotency.replay as JsonObject;
    const reservation = await transaction.get(`reservas/${reservationId}`);
    if (!reservation || reservation.data.bancaId !== ctx.env.BANCA_ID || reservation.data.clienteId !== identity.clientId) {
      throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
    }
    const items = await transaction.query("itensReserva", itemQuery(reservationId));
    const mutable = items.filter((item) => ACTIVE_ITEM_STATUSES.includes(String(item.data.status)));
    const inventory = new Map<string, FirestoreDocument>();
    for (const item of mutable) {
      const id = String(item.data.itemReparteId ?? "");
      if (!inventory.has(id)) {
        const document = await transaction.get(`itensReparte/${id}`);
        if (!document || document.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "inventory_invariant_failed", message: "Reservation stock record is missing.", status: 409 });
        inventory.set(id, document);
      }
    }
    const catalogRows = await catalogRowsForStocks(transaction, ctx.env, [...inventory.keys()]);
    const alreadyTerminal = mutable.length === 0;
    for (const item of mutable) {
      const itemReparteId = String(item.data.itemReparteId);
      const stock = inventory.get(itemReparteId)!;
      const quantity = Number(item.data.quantidade ?? 0);
      const reserved = Number(stock.data.quantidadeReservada ?? 0);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || reserved < quantity) throw new HttpError({ code: "inventory_invariant_failed", message: "Reservation stock balance is inconsistent.", status: 409 });
      const updated = { ...stock.data, quantidadeReservada: reserved - quantity, atualizadoEm: now.toISOString() };
      const movementId = crypto.randomUUID();
      transaction.set(`itensReparte/${itemReparteId}`, updated);
      transaction.set(`itensReserva/${item.id}`, { ...item.data, status: "CANCELADO_CLIENTE", canceladoEm: now.toISOString() });
      transaction.set(`movimentacoesEstoque/${movementId}`, {
        bancaId: ctx.env.BANCA_ID,
        itemReparteId,
        itemReservaId: item.id,
        tipo: "CANCELAMENTO",
        quantidade: quantity,
        saldoAntes: reservationAvailability(stock.data),
        saldoDepois: reservationAvailability(updated),
        motivo: "Cancelamento solicitado pelo cliente",
        criadoEm: now.toISOString(),
        usuarioId: null,
      }, { mustNotExist: true });
      inventory.set(itemReparteId, { ...stock, data: updated });
    }
    setCatalogAvailability(transaction, catalogRows, new Map([...inventory].map(([id, stock]) => [id, reservationAvailability(stock.data)])), now.toISOString());
    const finalItems = items.map((item) => mutable.find((entry) => entry.id === item.id) ? { ...item, data: { ...item.data, status: "CANCELADO_CLIENTE" } } : item);
    const finalStatus = alreadyTerminal ? reservation.data.status : reservationPublicStatus(finalItems);
    const nextStatus = finalStatus === "PARCIALMENTE_RETIRADA" ? finalStatus : finalStatus === "CONCLUIDA" ? finalStatus : "CANCELADA";
    const result = { reservationId, status: nextStatus, released: !alreadyTerminal };
    transaction.set(`reservas/${reservationId}`, { ...reservation.data, status: nextStatus, atualizadaEm: now.toISOString() });
    saveIdempotency(transaction, idempotency, result);
    return result;
  });
  return jsonResponse(ctx, response);
}

async function updateIntent(ctx: RequestContext, reservationId: string): Promise<Response> {
  await rateLimit(ctx, "client-write");
  if (!validDocumentId(reservationId)) throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
  const identity = await getClientIdentity(ctx);
  const body = await readJsonBody(ctx.request, 2_000);
  const intent = body.intent;
  if (!new Set(["SEM_RESPOSTA", "VOU_BUSCAR", "ESTOU_INDO", "NAO_VOU"]).has(String(intent))) {
    throw new HttpError({ code: "invalid_intent", message: "intent is invalid.", status: 400 });
  }
  const now = new Date().toISOString();
  const result = await ctx.db.transact(async (transaction) => {
    const idempotency = await prepareIdempotency(ctx, transaction, `reservation-intent:${identity.clientId}:${reservationId}`, { intent });
    if (idempotency.replay !== undefined) return idempotency.replay as JsonObject;
    const reservation = await transaction.get(`reservas/${reservationId}`);
    if (!reservation || reservation.data.bancaId !== ctx.env.BANCA_ID || reservation.data.clienteId !== identity.clientId) throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
    if (!ACTIVE_RESERVATION_STATUSES.includes(String(reservation.data.status))) throw new HttpError({ code: "reservation_closed", message: "This reservation is no longer active.", status: 409 });
    const response = { reservationId, intent };
    transaction.set(`reservas/${reservationId}`, { ...reservation.data, intencaoRetirada: intent, atualizadaEm: now });
    saveIdempotency(transaction, idempotency, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

async function rescheduleReservation(ctx: RequestContext, reservationId: string): Promise<Response> {
  await rateLimit(ctx, "client-write");
  if (!validDocumentId(reservationId)) throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
  const identity = await getClientIdentity(ctx);
  const body = await readJsonBody(ctx.request, 4_000);
  const desiredDate = requireString(body.desiredDate, "desiredDate", 10);
  const desiredTime = typeof body.desiredTime === "string" && body.desiredTime.trim() ? body.desiredTime.trim() : undefined;
  if (desiredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(desiredTime)) throw new HttpError({ code: "invalid_pickup_time", message: "desiredTime must use HH:mm.", status: 400 });
  const now = new Date();
  const result = await ctx.db.transact(async (transaction) => {
    const idem = await prepareIdempotency(ctx, transaction, `reservation-reschedule:${identity.clientId}:${reservationId}`, { desiredDate, desiredTime: desiredTime ?? null });
    if (idem.replay !== undefined) return idem.replay as JsonObject;
    const reservation = await transaction.get(`reservas/${reservationId}`);
    if (!reservation || reservation.data.bancaId !== ctx.env.BANCA_ID || reservation.data.clienteId !== identity.clientId) throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
    if (!ACTIVE_RESERVATION_STATUSES.includes(String(reservation.data.status))) throw new HttpError({ code: "reservation_closed", message: "This reservation can no longer be rescheduled.", status: 409 });
    const [bank, schedules, reservationItems, pendingNotifications] = await Promise.all([
      transaction.get(`bancas/${ctx.env.BANCA_ID}`),
      transaction.query(`bancas/${ctx.env.BANCA_ID}/horarios`, query("horarios", [], 7)),
      transaction.query("itensReserva", itemQuery(reservationId)),
      transaction.query("notificacoes", query("notificacoes", [
        eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
        eq("reservaId", firestoreString(reservationId)),
        eq("status", firestoreString("PENDENTE")),
      ], 50)),
    ]);
    if (!bank || bank.data.ativo === false) throw new HttpError({ code: "bank_not_found", message: "The bank is not available.", status: 404 });
    const activeItems = reservationItems.filter((item) => ACTIVE_ITEM_STATUSES.includes(String(item.data.status)));
    if (!activeItems.length) throw new HttpError({ code: "reservation_closed", message: "This reservation has no items that can be rescheduled.", status: 409 });
    const stockById = new Map<string, FirestoreDocument>();
    const reparteById = new Map<string, FirestoreDocument>();
    const cutoffs: Array<Date | null> = [];
    for (const reservationItem of activeItems) {
      const stockId = String(reservationItem.data.itemReparteId ?? "");
      let stock = stockById.get(stockId);
      if (!stock) {
        stock = await transaction.get(`itensReparte/${stockId}`) ?? undefined;
        if (!stock || stock.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "inventory_invariant_failed", message: "Reservation stock record is missing.", status: 409 });
        stockById.set(stockId, stock);
      }
      const reparteId = String(stock.data.reparteId ?? "");
      let reparte = reparteById.get(reparteId);
      if (!reparte) {
        reparte = await transaction.get(`repartes/${reparteId}`) ?? undefined;
        if (!reparte || reparte.data.bancaId !== ctx.env.BANCA_ID || reparte.data.status !== "ATIVO") throw new HttpError({ code: "reservations_closed", message: "One or more items are no longer available for reservation.", status: 409 });
        reparteById.set(reparteId, reparte);
      }
      let cutoffValue = stock.data.dataFimReservas ?? reparte.data.dataFimReservas;
      const collectionDate = stock.data.dataRecolhimentoOverride ?? reparte.data.dataRecolhimentoPrevista;
      if (!cutoffValue && collectionDate) {
        const date = new Date(String(collectionDate));
        const margin = Number(stock.data.margemSegurancaDias ?? reparte.data.margemSegurancaDias ?? bank.data.margemRecolhimentoDias ?? 2);
        if (!Number.isNaN(date.getTime())) date.setUTCDate(date.getUTCDate() - (Number.isInteger(margin) && margin >= 0 ? margin : 2));
        cutoffValue = Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
      const cutoff = typeof cutoffValue === "string" ? new Date(cutoffValue) : null;
      cutoffs.push(cutoff && !Number.isNaN(cutoff.getTime()) ? cutoff : null);
    }
    const weekday = localWeekday(desiredDate);
    const weekdayName = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][weekday];
    const schedule = schedules.find((entry) => Number(entry.data.diaSemana) === weekday || normalizeName(String(entry.data.diaSemana ?? "")) === weekdayName)?.data ?? defaultOpeningHours(weekday);
    const pickup = validatePickupWindow({ now, desiredDate, desiredTime, schedule, bank: bank.data, reservationCutoffs: cutoffs });
    const previous = { desiredDate: reservation.data.dataRetiradaPretendida, desiredTime: reservation.data.horarioAproximado ?? null, expiresAt: reservation.data.expiraEm };
    const nextScheduleVersion = Number(reservation.data.agendaVersao ?? 0) + 1;
    const updatedReservation = {
      ...reservation.data,
      dataRetiradaPretendida: pickup.pickupAt.toISOString(),
      horarioAproximado: desiredTime ?? null,
      expiraEm: pickup.expiresAt.toISOString(),
      intencaoRetirada: "SEM_RESPOSTA",
      agendaVersao: nextScheduleVersion,
      lembreteMeioEnviado: false,
      lembreteDiaEnviado: false,
      lembreteFechamentoEnviado: false,
      lembreteHorarioEnviado: false,
      lembreteAdminFechamentoEnviado: false,
      atualizadaEm: now.toISOString(),
    };
    for (const notification of pendingNotifications) transaction.set(`notificacoes/${notification.id}`, { ...notification.data, status: "CANCELADA" });
    transaction.set(`reservas/${reservationId}`, updatedReservation);
    const historyId = crypto.randomUUID();
    transaction.set(`historicoAlteracoes/${historyId}`, {
      bancaId: ctx.env.BANCA_ID,
      entidadeTipo: "RESERVA",
      entidadeId: reservationId,
      campo: "agendamento",
      antes: previous,
      depois: { desiredDate: updatedReservation.dataRetiradaPretendida, desiredTime: updatedReservation.horarioAproximado, expiresAt: updatedReservation.expiraEm },
      tipo: "REAGENDAMENTO_CLIENTE",
      clienteId: identity.clientId,
      usuarioId: null,
      criadoEm: now.toISOString(),
    }, { mustNotExist: true });
    const response = { reservationId, desiredDate: updatedReservation.dataRetiradaPretendida, desiredTime: updatedReservation.horarioAproximado, expiresAt: updatedReservation.expiraEm, pickupIntent: updatedReservation.intencaoRetirada };
    saveIdempotency(transaction, idem, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

async function getProfile(ctx: RequestContext): Promise<Response> {
  const identity = await getClientIdentity(ctx);
  return jsonResponse(ctx, { profile: { clientId: identity.clientId, name: identity.client.nome, phone: identity.client.telefone, maskedPhone: maskPhone(String(identity.client.telefone ?? "")) } });
}

async function updateProfile(ctx: RequestContext): Promise<Response> {
  await rateLimit(ctx, "client-write");
  const identity = await getClientIdentity(ctx);
  const body = await readJsonBody(ctx.request, 8_000);
  const name = requireString(body.name, "name", 80);
  const phone = normalizePhone(requireString(body.phone, "phone", 32));
  const normalizedName = normalizeName(name);
  if (normalizedName.length < 2 || phone.length < 10 || phone.length > 13) throw new HttpError({ code: "invalid_profile", message: "Name or phone is invalid.", status: 400 });
  const nextPhoneHash = await hashCustomerPhone(ctx.env, phone);
  const oldPhoneHash = String(identity.client.telefoneHash ?? await hashCustomerPhone(ctx.env, String(identity.client.telefoneNormalizado ?? identity.client.telefone ?? "")));
  const now = new Date().toISOString();
  const result = await ctx.db.transact(async (transaction) => {
    const idempotency = await prepareIdempotency(ctx, transaction, `client-profile:${identity.clientId}`, { name, phone });
    if (idempotency.replay !== undefined) return idempotency.replay as JsonObject;
    const [session, client, newPhoneIndex] = await Promise.all([
      transaction.get(`sessoesClientes/${identity.sessionId}`),
      transaction.get(`clientes/${identity.clientId}`),
      transaction.get(`indiceTelefonesClientes/${nextPhoneHash}`),
    ]);
    if (!session || session.data.ativa !== true || session.data.clienteId !== identity.clientId || !client || client.data.bancaId !== ctx.env.BANCA_ID) {
      throw new HttpError({ code: "session_invalid", message: "The client session is invalid or has expired.", status: 401 });
    }
    if (newPhoneIndex && newPhoneIndex.data.clienteId !== identity.clientId) throw new HttpError({ code: "phone_already_registered", message: "That phone number is already linked to another profile.", status: 409 });
    const updated = {
      ...client.data,
      nome: name,
      nomeNormalizado: normalizedName,
      telefone: phone,
      telefoneNormalizado: phone,
      telefoneFinal: phone.slice(-4),
      telefoneHash: nextPhoneHash,
      atualizadoEm: now,
    };
    if (oldPhoneHash !== nextPhoneHash) transaction.delete(`indiceTelefonesClientes/${oldPhoneHash}`);
    transaction.set(`indiceTelefonesClientes/${nextPhoneHash}`, { bancaId: ctx.env.BANCA_ID, clienteId: identity.clientId, atualizadoEm: now }, newPhoneIndex ? {} : { mustNotExist: true });
    transaction.set(`clientes/${identity.clientId}`, updated);
    transaction.set(`sessoesClientes/${identity.sessionId}`, { ...session.data, ultimoAcesso: now });
    const response = { profile: { clientId: identity.clientId, name, phone, maskedPhone: maskPhone(phone) } };
    saveIdempotency(transaction, idempotency, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

export async function handleClientRoute(ctx: RequestContext): Promise<Response | null> {
  const { pathname } = ctx.url;
  const { method } = ctx.request;
  if (method === "POST" && pathname === "/api/client/sessions") return createSession(ctx);
  if (method === "GET" && pathname === "/api/client/profile") return getProfile(ctx);
  if (method === "PATCH" && pathname === "/api/client/profile") return updateProfile(ctx);
  if (method === "GET" && pathname === "/api/client/reservations") return listReservations(ctx);
  if (method === "GET" && pathname === "/api/client/notifications") return listNotifications(ctx);
  if (method === "POST" && pathname === "/api/client/reservations") return createReservation(ctx);

  const cancelMatch = pathname.match(/^\/api\/client\/reservations\/([A-Za-z0-9_-]+)\/cancel$/);
  if (method === "POST" && cancelMatch) return cancelReservation(ctx, cancelMatch[1]);
  const intentMatch = pathname.match(/^\/api\/client\/reservations\/([A-Za-z0-9_-]+)\/intent$/);
  if (method === "PATCH" && intentMatch) return updateIntent(ctx, intentMatch[1]);
  const rescheduleMatch = pathname.match(/^\/api\/client\/reservations\/([A-Za-z0-9_-]+)\/reschedule$/);
  if (method === "PATCH" && rescheduleMatch) return rescheduleReservation(ctx, rescheduleMatch[1]);
  return null;
}
