import { andFilters, catalogRowsForStocks, compare, eq, firestoreString, jsonResponse, parseLimit, prepareIdempotency, query, readJsonBody, saveIdempotency, setCatalogAvailability } from "../api";
import { assertInventoryValid, defaultOpeningHours, isPlainObject, localDateString, reservationAvailability, requirePositiveInteger, requireString } from "../domain";
import { hashClientSessionToken, maskPhone, normalizeName, requireAdmin } from "../security";
import type { AdminIdentity, FirestoreDocument, JsonObject, RequestContext } from "../types";
import { HttpError } from "../types";

const ACTIVE_ITEM_STATUSES = ["RESERVADO", "RETIRADA_INFORMADA"];
const HISTORY_COLLECTIONS: Record<string, { collection: string; dateField: string }> = {
  sales: { collection: "historicoVendas", dateField: "confirmadaEm" },
  returns: { collection: "historicoDevolucoes", dateField: "data" },
  changes: { collection: "historicoAlteracoes", dateField: "criadoEm" },
};

function validDocumentId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function reservationItemsQuery(reservationId: string): JsonObject {
  return query("itensReserva", [eq("reservaId", firestoreString(reservationId))], 120, [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }]);
}

function inventoryOnHand(data: JsonObject): number {
  return Number(data.quantidadeRecebida ?? 0) + Number(data.quantidadeAjustePositivo ?? 0) -
    Number(data.quantidadeRetirada ?? 0) - Number(data.quantidadeDevolvida ?? 0) - Number(data.quantidadeAjusteNegativo ?? 0);
}

function weekdayIndex(value: unknown, fallback: string): number | null {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
  const name = normalizeName(String(value ?? ""));
  const days = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const named = days.indexOf(name);
  if (named >= 0) return named;
  const id = Number(fallback);
  return Number.isInteger(id) && id >= 0 && id <= 6 ? id : null;
}

function pageToken(ctx: RequestContext, date: string, id: string): Promise<string> {
  return hashClientSessionToken(ctx.env, `admin-cursor:v1:${date}:${id}`).then((sig) => {
    const payload = JSON.stringify({ date, id, sig });
    const bytes = new TextEncoder().encode(payload);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  });
}

async function readPageToken(ctx: RequestContext, value: string | null): Promise<{ date: string; id: string } | null> {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  let decoded: { date?: unknown; id?: unknown; sig?: unknown };
  try { decoded = JSON.parse(atob(base64)) as { date?: unknown; id?: unknown; sig?: unknown }; } catch {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
  if (typeof decoded.date !== "string" || typeof decoded.id !== "string" || typeof decoded.sig !== "string" || !validDocumentId(decoded.id)) {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
  if (decoded.sig !== await hashClientSessionToken(ctx.env, `admin-cursor:v1:${decoded.date}:${decoded.id}`)) {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
  return { date: decoded.date, id: decoded.id };
}

function itemReservationIdempotencyBody(body: JsonObject): Array<{ itemReservationId: string; quantity: number }> {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    throw new HttpError({ code: "invalid_items", message: "items must contain 1 to 20 reservation items.", status: 400 });
  }
  const seen = new Set<string>();
  return body.items.map((entry) => {
    if (!isPlainObject(entry)) throw new HttpError({ code: "invalid_items", message: "Each item must be an object.", status: 400 });
    const itemReservationId = requireString(entry.itemReservationId, "itemReservationId", 128);
    if (!validDocumentId(itemReservationId) || seen.has(itemReservationId)) throw new HttpError({ code: "invalid_items", message: "itemReservationId is invalid or repeated.", status: 400 });
    seen.add(itemReservationId);
    return { itemReservationId, quantity: requirePositiveInteger(entry.quantity, "quantity", 50) };
  });
}

async function getAdminReservations(ctx: RequestContext): Promise<Response> {
  const { searchParams } = ctx.url;
  const limit = parseLimit(searchParams.get("limit"), 25, 50);
  const status = searchParams.get("status")?.trim().toUpperCase();
  const allowedStatuses = new Set(["ATIVA", "PARCIALMENTE_RETIRADA", "CONCLUIDA", "CANCELADA", "EXPIRADA"]);
  if (status && !allowedStatuses.has(status)) throw new HttpError({ code: "invalid_status", message: "status is invalid.", status: 400 });
  const filters = [eq("bancaId", firestoreString(ctx.env.BANCA_ID))];
  if (status) filters.push(eq("status", firestoreString(status)));
  const cursor = await readPageToken(ctx, searchParams.get("cursor"));
  const orderBy = [{ field: { fieldPath: "criadaEm" }, direction: "DESCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }];
  const startAt = cursor ? { values: [firestoreString(cursor.date), { referenceValue: `projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/reservas/${cursor.id}` }], before: false } : undefined;
  const documents = await ctx.db.query("reservas", query("reservas", filters, limit + 1, orderBy, startAt));
  const visible = documents.slice(0, limit);
  const clientIds = [...new Set(visible.map((item) => String(item.data.clienteId ?? "")).filter(Boolean))];
  const clients = await ctx.db.batchGet(clientIds.map((id) => `clientes/${id}`));
  const result = [];
  for (const reservation of visible) {
    const clientId = String(reservation.data.clienteId ?? "");
    const client = clients.get(`projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/clientes/${clientId}`);
    const items = await ctx.db.query("itensReserva", reservationItemsQuery(reservation.id));
    result.push({
      id: reservation.id,
      status: reservation.data.status,
      createdAt: reservation.data.criadaEm,
      desiredDate: reservation.data.dataRetiradaPretendida,
      desiredTime: reservation.data.horarioAproximado ?? null,
      expiresAt: reservation.data.expiraEm,
      pickupIntent: reservation.data.intencaoRetirada,
      customer: client ? {
        clientId,
        name: client.data.nome,
        maskedPhone: maskPhone(String(client.data.telefone ?? "")),
      } : null,
      items: [...new Map(items.map((item) => [String(item.data.itemReparteId ?? item.id), item])).keys()].map((key) => {
        const rows = items.filter((item) => String(item.data.itemReparteId ?? item.id) === key);
        const open = rows.find((item) => ACTIVE_ITEM_STATUSES.includes(String(item.data.status)));
        const representative = open ?? rows[0];
        const quantityWithdrawn = rows.filter((item) => item.data.status === "RETIRADO").reduce((sum, item) => sum + Number(item.data.quantidade ?? 0), 0);
        const quantity = Math.max(...rows.map((item) => Number(item.data.quantidadeOriginal ?? 0)), quantityWithdrawn + Number(open?.data.quantidade ?? 0));
        return {
          id: open?.id ?? representative.id,
          itemReparteId: representative.data.itemReparteId,
          productId: representative.data.produtoId,
          title: representative.data.tituloSnapshot ?? "",
          volume: representative.data.volumeSnapshot ?? null,
          quantity,
          quantityWithdrawn,
          price: representative.data.precoUnitarioSnapshot ?? null,
          status: open ? open.data.status : quantityWithdrawn >= quantity ? "RETIRADO" : representative.data.status,
        };
      }),
    });
  }
  const last = visible.at(-1);
  const nextCursor = documents.length > limit && last ? await pageToken(ctx, String(last.data.criadaEm), last.id) : null;
  return jsonResponse(ctx, { reservations: result, page: { limit, nextCursor } });
}

async function dashboard(ctx: RequestContext): Promise<Response> {
  const now = new Date();
  const today = localDateString(now);
  const [year, month, day] = today.split("-").map(Number);
  const tomorrowDate = new Date(Date.UTC(year, month - 1, day + 1));
  const tomorrow = `${tomorrowDate.getUTCFullYear()}-${String(tomorrowDate.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrowDate.getUTCDate()).padStart(2, "0")}`;
  const todayStart = new Date(`${today}T00:00:00-03:00`).toISOString();
  const tomorrowStart = new Date(`${tomorrow}T00:00:00-03:00`).toISOString();
  const activeFilters = [
    eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
    { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: [firestoreString("ATIVA"), firestoreString("PARCIALMENTE_RETIRADA")] } } },
  ];
  const reservationsTodayFilters = [
    ...activeFilters,
    compare("dataRetiradaPretendida", "GREATER_THAN_OR_EQUAL", firestoreString(todayStart)),
    compare("dataRetiradaPretendida", "LESS_THAN", firestoreString(tomorrowStart)),
  ];
  const [reservations, reservationsToday] = await Promise.all([
    ctx.db.query("reservas", query("reservas", reservationsTodayFilters, 31, [{ field: { fieldPath: "dataRetiradaPretendida" }, direction: "ASCENDING" }])),
    ctx.db.count("reservas", { from: [{ collectionId: "reservas" }], where: andFilters(reservationsTodayFilters) }),
  ]);
  const repartes = await ctx.db.query("repartes", query("repartes", [
    eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
    eq("status", firestoreString("ATIVO")),
  ], 100, [{ field: { fieldPath: "dataRecolhimentoPrevista" }, direction: "ASCENDING" }]));
  const nextWeek = new Date(now.getTime() + 7 * 86_400_000);
  const collectionFilters = [
    eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
    eq("status", firestoreString("ATIVO")),
    compare("dataRecolhimentoPrevista", "GREATER_THAN_OR_EQUAL", firestoreString(now.toISOString())),
    compare("dataRecolhimentoPrevista", "LESS_THAN_OR_EQUAL", firestoreString(nextWeek.toISOString())),
  ];
  const [activeReservations, draftLists, publishedLists, recollectionsDueSoon] = await Promise.all([
    ctx.db.count("reservas", { from: [{ collectionId: "reservas" }], where: andFilters(activeFilters) }),
    ctx.db.count("listas", { from: [{ collectionId: "listas" }], where: andFilters([eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("status", firestoreString("RASCUNHO"))]) }),
    ctx.db.count("listas", { from: [{ collectionId: "listas" }], where: andFilters([eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("status", firestoreString("PUBLICADA"))]) }),
    ctx.db.count("repartes", { from: [{ collectionId: "repartes" }], where: andFilters(collectionFilters) }),
  ]);
  return jsonResponse(ctx, {
    reservationsToday,
    activeReservations,
    draftLists,
    publishedLists,
    recollectionsDueSoon,
    reservations: reservations.slice(0, 30).map((entry) => ({ id: entry.id, customerName: entry.data.clienteNomeSnapshot, desiredDate: entry.data.dataRetiradaPretendida, desiredTime: entry.data.horarioAproximado ?? null, pickupIntent: entry.data.intencaoRetirada ?? "SEM_RESPOSTA", status: entry.data.status })),
    upcomingRepartes: repartes.slice(0, 20).map((entry) => ({ id: entry.id, title: entry.data.titulo, plannedCollectionAt: entry.data.dataRecolhimentoPrevista, status: entry.data.status })),
  });
}

async function withdrawReservation(ctx: RequestContext, user: AdminIdentity, reservationId: string): Promise<Response> {
  if (!validDocumentId(reservationId)) throw new HttpError({ code: "not_found", message: "Reservation not found.", status: 404 });
  const body = await readJsonBody(ctx.request, 12_000);
  const requestedItems = itemReservationIdempotencyBody(body);
  const now = new Date().toISOString();
  const result = await ctx.db.transact(async (transaction) => {
    const idem = await prepareIdempotency(ctx, transaction, `withdraw:${user.uid}:${reservationId}`, { items: requestedItems });
    if (idem.replay !== undefined) return idem.replay as JsonObject;
    const reservation = await transaction.get(`reservas/${reservationId}`);
    if (!reservation || reservation.data.bancaId !== ctx.env.BANCA_ID || !["ATIVA", "PARCIALMENTE_RETIRADA"].includes(String(reservation.data.status))) {
      throw new HttpError({ code: "reservation_unavailable", message: "This reservation cannot be withdrawn.", status: 409 });
    }
    const items = await transaction.query("itensReserva", reservationItemsQuery(reservationId));
    const selected = requestedItems.map((requestItem) => {
      const item = items.find((entry) => entry.id === requestItem.itemReservationId);
      if (!item || !ACTIVE_ITEM_STATUSES.includes(String(item.data.status))) throw new HttpError({ code: "reservation_item_unavailable", message: "One or more reservation items cannot be withdrawn.", status: 409 });
      if (requestItem.quantity > Number(item.data.quantidade ?? 0)) throw new HttpError({ code: "invalid_quantity", message: "Withdrawal quantity exceeds the remaining reserved quantity.", status: 409 });
      return { request: requestItem, item };
    });
    const inventories = new Map<string, FirestoreDocument>();
    for (const selection of selected) {
      const id = String(selection.item.data.itemReparteId ?? "");
      if (!inventories.has(id)) {
        const inventory = await transaction.get(`itensReparte/${id}`);
        if (!inventory || inventory.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "inventory_invariant_failed", message: "Reservation stock record is missing.", status: 409 });
        inventories.set(id, inventory);
      }
    }
    const catalogRows = await catalogRowsForStocks(transaction, ctx.env, [...inventories.keys()]);
    const updatedAvailability = new Map<string, number>();
    let withdrawn = 0;
    for (const selection of selected) {
      const original = selection.item;
      const quantity = selection.request.quantity;
      const remaining = Number(original.data.quantidade) - quantity;
      const itemReparteId = String(original.data.itemReparteId);
      const stock = inventories.get(itemReparteId)!;
      const reserved = Number(stock.data.quantidadeReservada ?? 0);
      if (reserved < quantity) throw new HttpError({ code: "inventory_invariant_failed", message: "Reserved stock is inconsistent.", status: 409 });
      const updatedStock = {
        ...stock.data,
        quantidadeReservada: reserved - quantity,
        quantidadeRetirada: Number(stock.data.quantidadeRetirada ?? 0) + quantity,
        atualizadoEm: now,
      };
      assertInventoryValid(updatedStock);
      transaction.set(`itensReparte/${itemReparteId}`, updatedStock);
      updatedAvailability.set(itemReparteId, reservationAvailability(updatedStock));
      if (remaining === 0) transaction.set(`itensReserva/${original.id}`, { ...original.data, status: "RETIRADO", retiradaEm: now, retiradoPor: user.uid });
      else {
        transaction.set(`itensReserva/${original.id}`, { ...original.data, quantidade: remaining, atualizadoEm: now });
        const withdrawnItemId = crypto.randomUUID();
        transaction.set(`itensReserva/${withdrawnItemId}`, {
          ...original.data,
          quantidade: quantity,
          status: "RETIRADO",
          itemReservaOrigemId: original.id,
          retiradaEm: now,
          retiradoPor: user.uid,
          criadoEm: now,
        }, { mustNotExist: true });
      }
      const price = original.data.precoUnitarioSnapshot == null ? null : Number(original.data.precoUnitarioSnapshot);
      const stockMovementId = crypto.randomUUID();
      const onHandBefore = inventoryOnHand(stock.data);
      transaction.set(`movimentacoesEstoque/${stockMovementId}`, {
        bancaId: ctx.env.BANCA_ID,
        itemReparteId,
        itemReservaId: original.id,
        tipo: "RETIRADA",
        quantidade: quantity,
        saldoAntes: onHandBefore,
        saldoDepois: onHandBefore - quantity,
        motivo: "Retirada confirmada no balcão",
        criadoEm: now,
        usuarioId: user.uid,
      }, { mustNotExist: true });
      const saleId = crypto.randomUUID();
      transaction.set(`historicoVendas/${saleId}`, {
        bancaId: ctx.env.BANCA_ID,
        reservaId: reservationId,
        itemReservaId: original.id,
        clienteId: reservation.data.clienteId,
        produtoId: original.data.produtoId,
        itemReparteId,
        quantidade: quantity,
        precoUnitarioSnapshot: price,
        totalSnapshot: price == null ? null : price * quantity,
        confirmadaEm: now,
        confirmadoPor: user.uid,
      }, { mustNotExist: true });
      inventories.set(itemReparteId, { ...stock, data: updatedStock });
      withdrawn += quantity;
    }
    setCatalogAvailability(transaction, catalogRows, updatedAvailability, now);
    const remainingItems = items.map((item) => {
      const picked = selected.find((selection) => selection.item.id === item.id);
      if (!picked) return item;
      const remaining = Number(item.data.quantidade) - picked.request.quantity;
      return { ...item, data: { ...item.data, status: remaining === 0 ? "RETIRADO" : item.data.status, quantidade: remaining } };
    });
    const hasOpen = remainingItems.some((item) => ACTIVE_ITEM_STATUSES.includes(String(item.data.status)) && Number(item.data.quantidade ?? 0) > 0);
    const hasWithdrawn = remainingItems.some((item) => item.data.status === "RETIRADO");
    const status = hasOpen ? "PARCIALMENTE_RETIRADA" : hasWithdrawn ? "CONCLUIDA" : "CANCELADA";
    transaction.set(`reservas/${reservationId}`, { ...reservation.data, status, atualizadaEm: now });
    const response = { reservationId, status, withdrawnQuantity: withdrawn };
    saveIdempotency(transaction, idem, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

async function listRepartes(ctx: RequestContext): Promise<Response> {
  const status = ctx.url.searchParams.get("status")?.trim().toUpperCase();
  const allowed = new Set(["RASCUNHO", "ATIVO", "AGUARDANDO_RECOLHIMENTO", "ENCERRADO", "ARQUIVADO"]);
  if (status && !allowed.has(status)) throw new HttpError({ code: "invalid_status", message: "status is invalid.", status: 400 });
  const limit = parseLimit(ctx.url.searchParams.get("limit"), 30, 100);
  const filters = [eq("bancaId", firestoreString(ctx.env.BANCA_ID))];
  if (status) filters.push(eq("status", firestoreString(status)));
  const documents = await ctx.db.query("repartes", query("repartes", filters, limit, [{ field: { fieldPath: "dataRecolhimentoPrevista" }, direction: "ASCENDING" }]));
  return jsonResponse(ctx, {
    repartes: documents.map((document) => ({ id: document.id, title: document.data.titulo, status: document.data.status, receivedAt: document.data.dataRecebimento, plannedCollectionAt: document.data.dataRecolhimentoPrevista, reservationCutoffAt: document.data.dataFimReservas })),
    page: { limit, nextCursor: null },
  });
}

async function listLists(ctx: RequestContext): Promise<Response> {
  const status = ctx.url.searchParams.get("status")?.trim().toUpperCase();
  const allowed = new Set(["RASCUNHO", "PUBLICADA", "ENCERRADA", "ARQUIVADA"]);
  if (status && !allowed.has(status)) throw new HttpError({ code: "invalid_status", message: "status is invalid.", status: 400 });
  const limit = parseLimit(ctx.url.searchParams.get("limit"), 25, 50);
  const filters = [eq("bancaId", firestoreString(ctx.env.BANCA_ID))];
  if (status) filters.push(eq("status", firestoreString(status)));
  const cursor = await readPageToken(ctx, ctx.url.searchParams.get("cursor"));
  const orderBy = [{ field: { fieldPath: "criadaEm" }, direction: "DESCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }];
  const startAt = cursor ? { values: [firestoreString(cursor.date), { referenceValue: `projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/listas/${cursor.id}` }], before: false } : undefined;
  const documents = await ctx.db.query("listas", query("listas", filters, limit + 1, orderBy, startAt));
  const visible = documents.slice(0, limit);
  const last = visible.at(-1);
  return jsonResponse(ctx, {
    lists: visible.map((document) => ({
      id: document.id,
      title: document.data.titulo,
      totalItems: Number(document.data.totalItems ?? 0),
      createdAt: document.data.criadaEm,
      publishedAt: document.data.publicadaEm ?? null,
      status: document.data.status,
      version: Number(document.data.versao ?? 1),
    })),
    page: { limit, nextCursor: documents.length > limit && last ? await pageToken(ctx, String(last.data.criadaEm), last.id) : null },
  });
}

async function getReconciliation(ctx: RequestContext, reparteId: string): Promise<Response> {
  if (!validDocumentId(reparteId)) throw new HttpError({ code: "not_found", message: "Reparte not found.", status: 404 });
  const [reparte, items, recolhimento] = await Promise.all([
    ctx.db.get(`repartes/${reparteId}`),
    ctx.db.query("itensReparte", query("itensReparte", [eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("reparteId", firestoreString(reparteId))], 100, [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }])),
    ctx.db.get(`recolhimentos/reparte-${reparteId}`),
  ]);
  if (!reparte || reparte.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "not_found", message: "Reparte not found.", status: 404 });
  const countedItems = recolhimento ? await ctx.db.query("itensRecolhimento", query("itensRecolhimento", [eq("recolhimentoId", firestoreString(recolhimento.id))], 100)) : [];
  const countedByItem = new Map(countedItems.map((entry) => [String(entry.data.itemReparteId), entry]));
  return jsonResponse(ctx, {
    reparte: { id: reparteId, title: reparte.data.titulo, status: reparte.data.status, plannedCollectionAt: reparte.data.dataRecolhimentoPrevista },
    collection: recolhimento ? { id: recolhimento.id, status: recolhimento.data.status, startedAt: recolhimento.data.iniciadoEm, confirmedAt: recolhimento.data.confirmadoEm } : null,
    items: items.map((item) => ({
      itemReparteId: item.id,
      productId: item.data.produtoId,
      title: item.data.tituloSnapshot,
      volume: item.data.volumeSnapshot ?? null,
      quantityExpected: inventoryOnHand(item.data),
      quantityFound: countedByItem.get(item.id)?.data.quantidadeEncontrada ?? null,
      quantityReturned: countedByItem.get(item.id)?.data.quantidadeDevolvida ?? null,
      resolution: countedByItem.get(item.id)?.data.resolucao ?? countedByItem.get(item.id)?.data.observacao ?? null,
      reserved: Number(item.data.quantidadeReservada ?? 0),
      status: item.data.status,
    })),
  });
}

interface ReconciliationInput {
  itemReparteId: string;
  quantityFound: number;
  resolution?: string;
  reason?: string;
}

function normalizeReconciliationItems(value: unknown): ReconciliationInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 70) throw new HttpError({ code: "invalid_items", message: "items must contain 1 to 70 count records.", status: 400 });
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isPlainObject(entry)) throw new HttpError({ code: "invalid_items", message: "Each count must be an object.", status: 400 });
    const itemReparteId = requireString(entry.itemReparteId, "itemReparteId", 128);
    if (!validDocumentId(itemReparteId) || seen.has(itemReparteId)) throw new HttpError({ code: "invalid_items", message: "itemReparteId is invalid or repeated.", status: 400 });
    seen.add(itemReparteId);
    if (entry.quantityFound === undefined || entry.quantityFound === null || entry.quantityFound === "") {
      throw new HttpError({ code: "quantity_found_required", message: "quantityFound must be entered explicitly for every item.", status: 400 });
    }
    const quantityFound = Number(entry.quantityFound);
    if (!Number.isSafeInteger(quantityFound) || quantityFound < 0 || quantityFound > 10_000) throw new HttpError({ code: "invalid_items", message: "quantityFound must be a non-negative whole number.", status: 400 });
    const resolution = typeof entry.resolution === "string" ? entry.resolution : undefined;
    const reason = typeof entry.reason === "string" ? entry.reason.trim().slice(0, 240) : undefined;
    return { itemReparteId, quantityFound, resolution, reason };
  });
}

async function reconcileReparte(ctx: RequestContext, user: AdminIdentity, reparteId: string): Promise<Response> {
  if (!validDocumentId(reparteId)) throw new HttpError({ code: "not_found", message: "Reparte not found.", status: 404 });
  const body = await readJsonBody(ctx.request, 20_000);
  const inputs = normalizeReconciliationItems(body.items);
  const now = new Date().toISOString();
  const collectionId = `reparte-${reparteId}`;
  const result = await ctx.db.transact(async (transaction) => {
    const idem = await prepareIdempotency(ctx, transaction, `reconcile:${user.uid}:${reparteId}`, { items: inputs, notes: body.notes ?? null });
    if (idem.replay !== undefined) return idem.replay as JsonObject;
    const [reparte, existingCollection, inventoryItems] = await Promise.all([
      transaction.get(`repartes/${reparteId}`),
      transaction.get(`recolhimentos/${collectionId}`),
      transaction.query("itensReparte", query("itensReparte", [eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("reparteId", firestoreString(reparteId))], 100, [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }])),
    ]);
    if (!reparte || reparte.data.bancaId !== ctx.env.BANCA_ID || !["ATIVO", "AGUARDANDO_RECOLHIMENTO"].includes(String(reparte.data.status))) throw new HttpError({ code: "reparte_unavailable", message: "Reparte cannot be reconciled.", status: 409 });
    const foundIds = new Set(inputs.map((item) => item.itemReparteId));
    if (inputs.length !== inventoryItems.length || inventoryItems.some((item) => !foundIds.has(item.id))) throw new HttpError({ code: "incomplete_reconciliation", message: "Count every item in the selected reparte before confirming reconciliation.", status: 400 });
    if (inventoryItems.some((item) => Number(item.data.quantidadeReservada ?? 0) > 0)) throw new HttpError({ code: "active_reservations", message: "Cancel or expire every active reservation before reconciling this reparte.", status: 409 });
    const catalogRows = await catalogRowsForStocks(transaction, ctx.env, inventoryItems.map((item) => item.id));

    const divergenceIds: string[] = [];
    const updatedAvailability = new Map<string, number>();
    for (const input of inputs) {
      const item = inventoryItems.find((candidate) => candidate.id === input.itemReparteId)!;
      const expected = inventoryOnHand(item.data);
      if (!Number.isSafeInteger(expected) || expected < 0) throw new HttpError({ code: "inventory_invariant_failed", message: "Inventory balance is inconsistent.", status: 409 });
      const difference = input.quantityFound - expected;
      let adjustmentType: "AJUSTE_POSITIVO" | "AJUSTE_NEGATIVO" | null = null;
      if (difference > 0) {
        if (input.resolution !== "AJUSTE_POSITIVO" || !input.reason || input.reason.length < 4) throw new HttpError({ code: "resolution_required", message: "An increase requires resolution AJUSTE_POSITIVO and a reason.", status: 400 });
        adjustmentType = "AJUSTE_POSITIVO";
      } else if (difference < 0) {
        if (!new Set(["PERDA", "VENDA_NAO_REGISTRADA", "ERRO_CONFERENCIA"]).has(String(input.resolution)) || !input.reason || input.reason.length < 4) throw new HttpError({ code: "resolution_required", message: "A shortage requires an explicit resolution and reason.", status: 400 });
        adjustmentType = "AJUSTE_NEGATIVO";
      }
      const updatedInventory: JsonObject = {
        ...item.data,
        quantidadeDevolvida: Number(item.data.quantidadeDevolvida ?? 0) + input.quantityFound,
        quantidadeAjustePositivo: Number(item.data.quantidadeAjustePositivo ?? 0) + Math.max(0, difference),
        quantidadeAjusteNegativo: Number(item.data.quantidadeAjusteNegativo ?? 0) + Math.max(0, -difference),
        status: "DEVOLVIDO",
        atualizadoEm: now,
      };
      assertInventoryValid(updatedInventory);
      transaction.set(`itensReparte/${item.id}`, updatedInventory);
      updatedAvailability.set(item.id, reservationAvailability(updatedInventory));
      transaction.set(`itensRecolhimento/${`${collectionId}-${item.id}`}`, {
        recolhimentoId: collectionId,
        itemReparteId: item.id,
        produtoId: item.data.produtoId ?? null,
        quantidadeEsperada: expected,
        quantidadeEncontrada: input.quantityFound,
        quantidadeDevolvida: input.quantityFound,
        divergente: difference !== 0,
        resolucao: input.resolution ?? null,
        observacao: input.reason ?? null,
      });
      const movementId = crypto.randomUUID();
      transaction.set(`movimentacoesEstoque/${movementId}`, {
        bancaId: ctx.env.BANCA_ID,
        itemReparteId: item.id,
        itemReservaId: null,
        tipo: "DEVOLUCAO",
        quantidade: input.quantityFound,
        saldoAntes: expected,
        saldoDepois: Math.max(0, expected - input.quantityFound),
        motivo: input.reason ?? "Devolução confirmada no recolhimento",
        criadoEm: now,
        usuarioId: user.uid,
      }, { mustNotExist: true });
      if (adjustmentType && difference !== 0) {
        const adjustmentId = crypto.randomUUID();
        transaction.set(`movimentacoesEstoque/${adjustmentId}`, {
          bancaId: ctx.env.BANCA_ID,
          itemReparteId: item.id,
          itemReservaId: null,
          tipo: adjustmentType,
          quantidade: Math.abs(difference),
          saldoAntes: adjustmentType === "AJUSTE_POSITIVO" ? expected : expected,
          saldoDepois: input.quantityFound,
          motivo: `${input.resolution}: ${input.reason}`,
          criadoEm: now,
          usuarioId: user.uid,
        }, { mustNotExist: true });
        const divergenceId = crypto.randomUUID();
        divergenceIds.push(divergenceId);
        transaction.set(`divergencias/${divergenceId}`, {
          bancaId: ctx.env.BANCA_ID,
          recolhimentoId: collectionId,
          itemReparteId: item.id,
          tipo: difference > 0 ? "SOBRA" : "FALTA",
          esperado: expected,
          encontrado: input.quantityFound,
          resolucao: `${input.resolution}: ${input.reason}`,
          resolvida: true,
          criadaEm: now,
          resolvidaEm: now,
        }, { mustNotExist: true });
      }
      const returnHistoryId = crypto.randomUUID();
      transaction.set(`historicoDevolucoes/${returnHistoryId}`, {
        bancaId: ctx.env.BANCA_ID,
        recolhimentoId: collectionId,
        reparteId,
        itemReparteId: item.id,
        produtoId: item.data.produtoId ?? null,
        quantidade: input.quantityFound,
        data: now,
        confirmadoPor: user.uid,
      }, { mustNotExist: true });
    }
    setCatalogAvailability(transaction, catalogRows, updatedAvailability, now);
    transaction.set(`recolhimentos/${collectionId}`, {
      bancaId: ctx.env.BANCA_ID,
      reparteId,
      dataPrevista: existingCollection?.data.dataPrevista ?? reparte.data.dataRecolhimentoPrevista ?? now,
      iniciadoEm: existingCollection?.data.iniciadoEm ?? now,
      confirmadoEm: now,
      status: "CONFIRMADO",
      observacoes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null,
    });
    transaction.set(`repartes/${reparteId}`, { ...reparte.data, status: "ENCERRADO", encerradaEm: now });
    const response = { reparteId, collectionId, status: "CONFIRMADO", divergenceIds };
    saveIdempotency(transaction, idem, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

async function listHistories(ctx: RequestContext): Promise<Response> {
  const type = ctx.url.searchParams.get("type") ?? "sales";
  const configuration = HISTORY_COLLECTIONS[type];
  if (!configuration) throw new HttpError({ code: "invalid_history_type", message: "type must be sales, returns, or changes.", status: 400 });
  const limit = parseLimit(ctx.url.searchParams.get("limit"), 30, 100);
  const documents = await ctx.db.query(configuration.collection, query(configuration.collection, [eq("bancaId", firestoreString(ctx.env.BANCA_ID))], limit, [{ field: { fieldPath: configuration.dateField }, direction: "DESCENDING" }]));
  return jsonResponse(ctx, { entries: documents.map((document) => ({ id: document.id, ...document.data })), page: { limit, nextCursor: null } });
}

async function getBankProfile(ctx: RequestContext): Promise<Response> {
  const [bank, schedules] = await Promise.all([
    ctx.db.get(`bancas/${ctx.env.BANCA_ID}`),
    ctx.db.query(`bancas/${ctx.env.BANCA_ID}/horarios`, query("horarios", [], 7, [{ field: { fieldPath: "diaSemana" }, direction: "ASCENDING" }])),
  ]);
  if (!bank || bank.data.ativo === false) throw new HttpError({ code: "bank_not_found", message: "Bank profile was not found.", status: 404 });
  return jsonResponse(ctx, {
    profile: {
      id: ctx.env.BANCA_ID,
      name: bank.data.nomeExibicao ?? null,
      phone: bank.data.telefone ?? null,
      address: bank.data.endereco ?? null,
      collectionSafetyMarginDays: bank.data.margemRecolhimentoDias ?? 2,
      withdrawalToleranceDays: bank.data.toleranciaRetiradaDias ?? 0,
    },
    hours: Array.from({ length: 7 }, (_, day) => {
      const hour = schedules.find((entry) => weekdayIndex(entry.data.diaSemana, entry.id) === day);
      const data = hour?.data ?? defaultOpeningHours(day);
      return { dayOfWeek: day, closed: data.fechado === true, opensAt: data.abre ?? data.horaAbertura ?? null, closesAt: data.fecha ?? data.horaFechamento ?? null };
    }),
  });
}

interface ListRowInput {
  itemReparteId?: string;
  productId?: string;
  title: string;
  volume: string | null;
  price: number | null;
  quantity: number | null;
  publisher: string | null;
  originalTitle: string | null;
  returnDate: string | null;
  code: string | null;
  type: string;
  confidence: number | null;
  issues: string[];
  requiresReview: boolean;
}

function normalizeListRows(value: unknown, optional: boolean): ListRowInput[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > 80 || (!optional && value.length === 0)) {
    throw new HttpError({ code: "invalid_items", message: "items must contain up to 80 product rows.", status: 400 });
  }
  const productTypes = new Set(["MANGA", "REVISTA", "BOX", "COLECIONAVEL", "OUTRO"]);
  const seenItemReparte = new Set<string>();
  return value.map((entry) => {
    if (!isPlainObject(entry)) throw new HttpError({ code: "invalid_items", message: "Each product row must be an object.", status: 400 });
    const title = requireString(entry.title, "title", 160);
    const volume = entry.volume == null || entry.volume === "" ? null : requireString(String(entry.volume), "volume", 40);
    const price = entry.price == null || entry.price === "" ? null : Number(entry.price);
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) throw new HttpError({ code: "invalid_price", message: "price must be zero or a positive amount.", status: 400 });
    const quantity = entry.quantity == null || entry.quantity === "" ? null : requirePositiveInteger(entry.quantity, "quantity", 1000);
    const itemReparteId = entry.itemReparteId == null || entry.itemReparteId === "" ? undefined : String(entry.itemReparteId);
    const productId = entry.productId == null || entry.productId === "" ? undefined : String(entry.productId);
    if ((itemReparteId && !validDocumentId(itemReparteId)) || (productId && !validDocumentId(productId))) throw new HttpError({ code: "invalid_items", message: "Product or lot ID is invalid.", status: 400 });
    if (itemReparteId && seenItemReparte.has(itemReparteId)) throw new HttpError({ code: "invalid_items", message: "An itemReparteId may appear only once in a list.", status: 400 });
    if (itemReparteId) seenItemReparte.add(itemReparteId);
    const returnDate = entry.returnDate == null || entry.returnDate === "" ? null : String(entry.returnDate);
    if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) throw new HttpError({ code: "invalid_return_date", message: "returnDate must use YYYY-MM-DD.", status: 400 });
    if (returnDate && Number.isNaN(new Date(`${returnDate}T12:00:00-03:00`).getTime())) throw new HttpError({ code: "invalid_return_date", message: "returnDate is invalid.", status: 400 });
    const type = String(entry.type ?? "MANGA").toUpperCase();
    if (!productTypes.has(type)) throw new HttpError({ code: "invalid_product_type", message: "type is not supported.", status: 400 });
    const publisher = entry.publisher == null || entry.publisher === "" ? null : requireString(entry.publisher, "publisher", 100);
    const originalTitle = entry.originalTitle == null || entry.originalTitle === "" ? null : requireString(entry.originalTitle, "originalTitle", 160);
    const code = entry.code == null || entry.code === "" ? null : requireString(entry.code, "code", 80);
    const confidence = entry.confidence == null ? null : Number(entry.confidence);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new HttpError({ code: "invalid_confidence", message: "confidence must be between 0 and 1.", status: 400 });
    const issues = entry.issues == null ? [] : entry.issues;
    if (!Array.isArray(issues) || issues.length > 20 || issues.some((issue) => typeof issue !== "string" || issue.length > 160)) throw new HttpError({ code: "invalid_issues", message: "issues must be a list of up to 20 short strings.", status: 400 });
    if (entry.requiresReview !== undefined && typeof entry.requiresReview !== "boolean") throw new HttpError({ code: "invalid_review_state", message: "requiresReview must be a boolean.", status: 400 });
    const requiresReview = entry.requiresReview === true;
    return { itemReparteId, productId, title, volume, price, quantity, publisher, originalTitle, returnDate, code, type, confidence, issues: issues.map((issue) => issue.trim()), requiresReview };
  });
}

function returnDateValues(returnDate: string | null, margin: number): { timestamp: string | null; cutoff: string | null } {
  if (!returnDate) return { timestamp: null, cutoff: null };
  const timestamp = new Date(`${returnDate}T23:59:59-03:00`);
  const cutoff = new Date(timestamp.getTime() - margin * 86_400_000);
  return { timestamp: timestamp.toISOString(), cutoff: cutoff.toISOString() };
}

async function getAdminList(ctx: RequestContext, listId: string): Promise<Response> {
  if (!validDocumentId(listId)) throw new HttpError({ code: "not_found", message: "List not found.", status: 404 });
  const list = await ctx.db.get(`listas/${listId}`);
  if (!list || list.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "not_found", message: "List not found.", status: 404 });
  const items = await ctx.db.query("itensLista", query("itensLista", [
    eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("listaId", firestoreString(listId)),
  ], 100, [{ field: { fieldPath: "ordem" }, direction: "ASCENDING" }]));
  const stockIds = [...new Set(items.map((item) => String(item.data.itemReparteId ?? "")).filter(Boolean))];
  const productIds = [...new Set(items.map((item) => String(item.data.produtoId ?? "")).filter(Boolean))];
  const [stocks, products] = await Promise.all([
    ctx.db.batchGet(stockIds.map((id) => `itensReparte/${id}`)),
    ctx.db.batchGet(productIds.map((id) => `produtos/${id}`)),
  ]);
  const getFrom = (documents: Map<string, FirestoreDocument>, collection: string, id: string) => documents.get(`projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${id}`);
  return jsonResponse(ctx, {
    list: { id: list.id, title: list.data.titulo, slug: list.data.slug ?? null, reparteId: list.data.reparteId ?? null, status: list.data.status, createdAt: list.data.criadaEm, publishedAt: list.data.publicadaEm ?? null, version: list.data.versao ?? 1 },
    items: items.map((item) => {
      const stock = getFrom(stocks, "itensReparte", String(item.data.itemReparteId ?? ""));
      const product = getFrom(products, "produtos", String(item.data.produtoId ?? ""));
      const date = stock?.data.dataRecolhimentoOverride ?? null;
      return {
        id: item.id,
        itemReparteId: item.data.itemReparteId,
        productId: item.data.produtoId,
        title: item.data.tituloExibicao ?? stock?.data.tituloSnapshot ?? product?.data.titulo ?? "",
        volume: item.data.volumeExibicao ?? stock?.data.volumeSnapshot ?? product?.data.volume ?? null,
        price: item.data.precoExibicao ?? stock?.data.precoVenda ?? null,
        quantity: stock?.data.quantidadeRecebida ?? null,
        publisher: product?.data.editora ?? null,
        originalTitle: product?.data.nomeOriginal ?? null,
        returnDate: typeof date === "string" ? date.slice(0, 10) : null,
        code: product?.data.codigo ?? null,
        type: product?.data.tipo ?? "MANGA",
        active: item.data.ativo === true,
        confidence: item.data.confidence ?? null,
        issues: Array.isArray(item.data.issues) ? item.data.issues : [],
        requiresReview: item.data.requiresReview === true,
      };
    }),
  });
}

async function writeList(ctx: RequestContext, user: AdminIdentity, listId: string | null): Promise<Response> {
  const body = await readJsonBody(ctx.request, 64_000);
  const title = requireString(body.title, "title", 120);
  if (listId !== null && body.items === undefined) throw new HttpError({ code: "invalid_items", message: "items is required when saving a list.", status: 400 });
  const rows = normalizeListRows(body.items, true);
  const suppliedReparteId = body.reparteId == null || body.reparteId === "" ? null : String(body.reparteId);
  if (suppliedReparteId && !validDocumentId(suppliedReparteId)) throw new HttpError({ code: "invalid_reparte", message: "reparteId is invalid.", status: 400 });
  const now = new Date().toISOString();
  const resolvedListId = listId ?? crypto.randomUUID();
  const idemBody = { listId: resolvedListId, title, reparteId: suppliedReparteId, items: rows };

  const result = await ctx.db.transact(async (transaction) => {
    const idem = await prepareIdempotency(ctx, transaction, `list-save:${user.uid}:${resolvedListId}`, idemBody);
    if (idem.replay !== undefined) return idem.replay as JsonObject;
    const bank = await transaction.get(`bancas/${ctx.env.BANCA_ID}`);
    if (!bank || bank.data.ativo === false) throw new HttpError({ code: "bank_not_found", message: "Bank profile is not available.", status: 404 });
    const existingList = listId ? await transaction.get(`listas/${resolvedListId}`) : null;
    if (listId && (!existingList || existingList.data.bancaId !== ctx.env.BANCA_ID)) throw new HttpError({ code: "not_found", message: "List not found.", status: 404 });
    const reparteId = String(existingList?.data.reparteId ?? suppliedReparteId ?? crypto.randomUUID());
    const newReparte = !existingList && !suppliedReparteId;
    const reparte = newReparte ? null : await transaction.get(`repartes/${reparteId}`);
    if (!newReparte && (!reparte || reparte.data.bancaId !== ctx.env.BANCA_ID)) throw new HttpError({ code: "reparte_not_found", message: "Reparte not found for this bank.", status: 404 });
    const oldListItems = existingList ? await transaction.query("itensLista", query("itensLista", [eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("listaId", firestoreString(resolvedListId))], 100, [{ field: { fieldPath: "ordem" }, direction: "ASCENDING" }])) : [];

    const stockById = new Map<string, FirestoreDocument>();
    const productById = new Map<string, FirestoreDocument>();
    for (const row of rows) {
      const stockId = row.itemReparteId;
      if (stockId) {
        const stock = await transaction.get(`itensReparte/${stockId}`);
        if (!stock || stock.data.bancaId !== ctx.env.BANCA_ID || stock.data.reparteId !== reparteId) throw new HttpError({ code: "item_reparte_not_found", message: "An item does not belong to this reparte.", status: 409 });
        stockById.set(stockId, stock);
        const productId = String(stock.data.produtoId ?? row.productId ?? "");
        if (row.productId && row.productId !== productId) throw new HttpError({ code: "product_mismatch", message: "Product does not match the selected item lot.", status: 409 });
        if (!productById.has(productId)) {
          const product = await transaction.get(`produtos/${productId}`);
          if (!product) throw new HttpError({ code: "product_not_found", message: "Product not found.", status: 404 });
          productById.set(productId, product);
        }
      } else if (row.productId) {
        const product = await transaction.get(`produtos/${row.productId}`);
        if (!product || product.data.ativo === false) throw new HttpError({ code: "product_not_found", message: "Product not found.", status: 404 });
        productById.set(row.productId, product);
      }
    }

    const listStatus = String(existingList?.data.status ?? "RASCUNHO");
    if (listStatus === "PUBLICADA" && rows.length === 0) throw new HttpError({ code: "list_empty", message: "A published list cannot be cleared; archive it instead.", status: 409 });
    if (listStatus === "PUBLICADA" && rows.some((row) => row.requiresReview)) throw new HttpError({ code: "review_required", message: "Review every changed row before saving a published list.", status: 409 });
    const publishedAt = listStatus === "PUBLICADA" ? String(existingList?.data.publicadaEm ?? now) : null;
    const keepIds = new Set<string>();
    const stockOutput: Array<{ row: ListRowInput; stockId: string; productId: string; stock: JsonObject; product: JsonObject; listItemId: string }> = [];
    for (const row of rows) {
      const stockId = row.itemReparteId ?? crypto.randomUUID();
      const stockDocument = row.itemReparteId ? stockById.get(stockId)! : null;
      const productId = String(stockDocument?.data.produtoId ?? row.productId ?? crypto.randomUUID());
      const priorProduct = productById.get(productId);
      const product: JsonObject = {
        ...(priorProduct?.data ?? {}),
        codigo: row.code,
        titulo: row.title,
        tituloNormalizado: normalizeName(row.title),
        nomeOriginal: row.originalTitle,
        volume: row.volume,
        editora: row.publisher,
        tipo: row.type,
        ativo: true,
        ...(priorProduct ? {} : { criadoEm: now }),
        atualizadoEm: now,
      };
      const dates = returnDateValues(row.returnDate, Number(reparte?.data.margemSegurancaDias ?? 2));
      const priorStock = stockDocument?.data ?? {};
      if (listStatus === "PUBLICADA" && !stockDocument && (row.quantity === null || row.price === null)) throw new HttpError({ code: "draft_incomplete", message: "Set a received quantity and price before adding a row to a published list.", status: 409 });
      const quantityReceived = row.quantity ?? (stockDocument ? stockDocument.data.quantidadeRecebida : null);
      const effectivePrice = row.price ?? (stockDocument ? (stockDocument.data.precoVenda as number | null) : null);
      if (listStatus === "PUBLICADA" && (quantityReceived == null || effectivePrice == null)) throw new HttpError({ code: "draft_incomplete", message: "Set a received quantity and price for every row before saving a published list.", status: 409 });
      const stock: JsonObject = {
        ...priorStock,
        bancaId: ctx.env.BANCA_ID,
        reparteId,
        produtoId: productId,
        tituloSnapshot: row.title,
        volumeSnapshot: row.volume,
        precoVenda: effectivePrice,
        quantidadeRecebida: quantityReceived,
        quantidadeReservada: Number(priorStock.quantidadeReservada ?? 0),
        quantidadeRetirada: Number(priorStock.quantidadeRetirada ?? 0),
        quantidadeDevolvida: Number(priorStock.quantidadeDevolvida ?? 0),
        quantidadeAjustePositivo: Number(priorStock.quantidadeAjustePositivo ?? 0),
        quantidadeAjusteNegativo: Number(priorStock.quantidadeAjusteNegativo ?? 0),
        dataRecolhimentoOverride: dates.timestamp,
        dataFimReservas: dates.cutoff,
        status: publishedAt ? (reservationAvailability({ ...priorStock, quantidadeRecebida: quantityReceived }) > 0 ? "DISPONIVEL" : "ESGOTADO") : (priorStock.status ?? "RASCUNHO"),
        publicadoEm: publishedAt ?? priorStock.publicadoEm ?? null,
        ...(stockDocument ? {} : { criadoEm: now }),
        atualizadoEm: now,
      };
      assertInventoryValid(stock);
      const listItemId = oldListItems.find((item) => item.data.itemReparteId === stockId)?.id ?? crypto.randomUUID();
      keepIds.add(listItemId);
      stockOutput.push({ row, stockId, productId, stock, product, listItemId });
    }

    for (const oldItem of oldListItems) {
      if (!keepIds.has(oldItem.id)) transaction.set(`itensLista/${oldItem.id}`, { ...oldItem.data, ativo: false, atualizadoEm: now });
    }
    if (newReparte) {
      const returnDates = rows.map((row) => row.returnDate).filter((value): value is string => Boolean(value)).sort();
      transaction.set(`repartes/${reparteId}`, {
        bancaId: ctx.env.BANCA_ID,
        fornecedorId: null,
        titulo: title,
        dataRecebimento: now,
        dataRecolhimentoPrevista: returnDates.length ? returnDateValues(returnDates[0], 0).timestamp : null,
        dataFimReservas: returnDates.length ? returnDateValues(returnDates[0], 2).cutoff : null,
        margemSegurancaDias: 2,
        status: "RASCUNHO",
        criadaEm: now,
        publicadaEm: null,
        encerradaEm: null,
      }, { mustNotExist: true });
    }
    for (const entry of stockOutput) {
      transaction.set(`produtos/${entry.productId}`, entry.product, productById.has(entry.productId) ? {} : { mustNotExist: true });
      transaction.set(`itensReparte/${entry.stockId}`, entry.stock, entry.row.itemReparteId ? {} : { mustNotExist: true });
      transaction.set(`itensLista/${entry.listItemId}`, {
        bancaId: ctx.env.BANCA_ID,
        listaId: resolvedListId,
        itemReparteId: entry.stockId,
        produtoId: entry.productId,
        ordem: rows.indexOf(entry.row),
        tituloExibicao: entry.row.title,
        volumeExibicao: entry.row.volume,
        precoExibicao: entry.stock.precoVenda ?? null,
        availableUnits: Math.max(0, reservationAvailability(entry.stock)),
        availabilityClass: reservationAvailability(entry.stock) <= 0 ? "SOLD_OUT" : reservationAvailability(entry.stock) <= 3 ? "LOW" : "AVAILABLE",
        confidence: entry.row.confidence,
        issues: entry.row.issues,
        requiresReview: entry.row.requiresReview,
        publicadoEm: publishedAt,
        ativo: true,
        atualizadoEm: now,
      }, oldListItems.some((item) => item.id === entry.listItemId) ? {} : { mustNotExist: true });
    }
    const list: JsonObject = {
      ...(existingList?.data ?? {}),
      bancaId: ctx.env.BANCA_ID,
      reparteId,
      titulo: title,
      slug: normalizeName(title).replace(/ /g, "-"),
      status: listStatus,
      criadaEm: existingList?.data.criadaEm ?? now,
      publicadaEm: existingList?.data.publicadaEm ?? null,
      versao: Number(existingList?.data.versao ?? 0) + 1,
      totalItems: rows.length,
      atualizadoEm: now,
    };
    transaction.set(`listas/${resolvedListId}`, list, existingList ? {} : { mustNotExist: true });
    const response = { listId: resolvedListId, reparteId, status: listStatus, itemCount: rows.length, version: list.versao };
    saveIdempotency(transaction, idem, response);
    return response;
  });
  return jsonResponse(ctx, result, listId ? 200 : 201);
}

async function publishList(ctx: RequestContext, user: AdminIdentity, listId: string): Promise<Response> {
  if (!validDocumentId(listId)) throw new HttpError({ code: "not_found", message: "List not found.", status: 404 });
  const now = new Date().toISOString();
  const result = await ctx.db.transact(async (transaction) => {
    const idem = await prepareIdempotency(ctx, transaction, `list-publish:${user.uid}:${listId}`, { listId });
    if (idem.replay !== undefined) return idem.replay as JsonObject;
    const list = await transaction.get(`listas/${listId}`);
    if (!list || list.data.bancaId !== ctx.env.BANCA_ID) throw new HttpError({ code: "not_found", message: "List not found.", status: 404 });
    if (list.data.status === "PUBLICADA") {
      const response = { listId, reparteId: list.data.reparteId ?? null, status: "PUBLICADA", itemCount: Number(list.data.totalItems ?? 0), version: Number(list.data.versao ?? 1), publishedAt: list.data.publicadaEm ?? now, alreadyPublished: true };
      saveIdempotency(transaction, idem, response);
      return response;
    }
    if (list.data.status !== "RASCUNHO") throw new HttpError({ code: "list_not_publishable", message: "Only draft lists can be published.", status: 409 });
    const items = await transaction.query("itensLista", query("itensLista", [eq("bancaId", firestoreString(ctx.env.BANCA_ID)), eq("listaId", firestoreString(listId)), eq("ativo", { booleanValue: true })], 81));
    if (!items.length || items.length > 80) throw new HttpError({ code: "list_empty", message: "A list must have 1 to 80 active rows to publish.", status: 409 });
    const itemReparteIds = [...new Set(items.map((item) => String(item.data.itemReparteId ?? "")).filter(Boolean))];
    const stockById = new Map<string, FirestoreDocument>();
    const reparteIds = new Set<string>();
    for (const itemReparteId of itemReparteIds) {
      const stock = await transaction.get(`itensReparte/${itemReparteId}`);
      if (!stock || stock.data.bancaId !== ctx.env.BANCA_ID || !stock.data.reparteId) throw new HttpError({ code: "stock_record_missing", message: "A list row is missing its stock record.", status: 409 });
      stockById.set(itemReparteId, stock);
      reparteIds.add(String(stock.data.reparteId));
    }
    const reparteById = new Map<string, FirestoreDocument>();
    for (const reparteId of reparteIds) {
      const reparte = await transaction.get(`repartes/${reparteId}`);
      if (!reparte || reparte.data.bancaId !== ctx.env.BANCA_ID || !["ATIVO", "RASCUNHO"].includes(String(reparte.data.status))) throw new HttpError({ code: "reparte_not_publishable", message: "An item belongs to a reparte that cannot be published.", status: 409 });
      reparteById.set(reparteId, reparte);
    }
    for (const item of items) {
      const stockId = String(item.data.itemReparteId);
      const stock = stockById.get(stockId)!;
      assertInventoryValid(stock.data);
      if (item.data.requiresReview === true) throw new HttpError({ code: "review_required", message: `Review this row before publishing (item ${item.id}).`, status: 409 });
      if (!Number.isSafeInteger(Number(stock.data.quantidadeRecebida)) || Number(stock.data.quantidadeRecebida) <= 0 ||
        (item.data.precoExibicao ?? stock.data.precoVenda) == null) {
        throw new HttpError({ code: "draft_incomplete", message: `Confirm received quantity and price for every row before publishing (item ${item.id}).`, status: 409 });
      }
      const available = reservationAvailability(stock.data);
      transaction.set(`itensReparte/${stockId}`, { ...stock.data, status: available > 0 ? "DISPONIVEL" : "ESGOTADO", publicadoEm: now, atualizadoEm: now });
      transaction.set(`itensLista/${item.id}`, {
        ...item.data,
        publicadoEm: now,
        ativo: true,
        availableUnits: Math.max(0, available),
        availabilityClass: available <= 0 ? "SOLD_OUT" : available <= 3 ? "LOW" : "AVAILABLE",
        atualizadoEm: now,
      });
    }
    for (const [reparteId, reparte] of reparteById) {
      if (reparte.data.status === "RASCUNHO") transaction.set(`repartes/${reparteId}`, { ...reparte.data, status: "ATIVO", publicadaEm: reparte.data.publicadaEm ?? now });
    }
    transaction.set(`listas/${listId}`, { ...list.data, status: "PUBLICADA", publicadaEm: now, totalItems: items.length, versao: Number(list.data.versao ?? 0) + 1, atualizadoEm: now });
    const response = { listId, reparteId: list.data.reparteId ?? null, status: "PUBLICADA", publishedAt: now, itemCount: items.length, version: Number(list.data.versao ?? 0) + 1 };
    saveIdempotency(transaction, idem, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

function validateHours(value: unknown): Array<{ id: string; day: number; closed: boolean; opens: string | null; closes: string | null }> {
  if (!Array.isArray(value) || value.length !== 7) throw new HttpError({ code: "invalid_hours", message: "hours must contain one entry for each day of the week.", status: 400 });
  const seen = new Set<number>();
  return value.map((entry) => {
    if (!isPlainObject(entry)) throw new HttpError({ code: "invalid_hours", message: "Each hour record must be an object.", status: 400 });
    const day = Number(entry.dayOfWeek ?? entry.day);
    const closed = entry.closed === true;
    const opensValue = entry.opensAt ?? entry.opens;
    const closesValue = entry.closesAt ?? entry.closes;
    const opens = typeof opensValue === "string" ? opensValue : null;
    const closes = typeof closesValue === "string" ? closesValue : null;
    if (!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day)) throw new HttpError({ code: "invalid_hours", message: "Each weekday must appear exactly once.", status: 400 });
    seen.add(day);
    if (!closed && (!opens || !closes || !/^([01]\d|2[0-3]):[0-5]\d$/.test(opens) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closes) || opens >= closes)) {
      throw new HttpError({ code: "invalid_hours", message: "Open days need valid opening and closing times.", status: 400 });
    }
    return { id: String(day), day, closed, opens: closed ? null : opens, closes: closed ? null : closes };
  });
}

async function updateBankProfile(ctx: RequestContext, user: AdminIdentity): Promise<Response> {
  const body = await readJsonBody(ctx.request, 12_000);
  const profile = isPlainObject(body.profile) ? body.profile : body;
  const idempotencyBody = {
    name: typeof profile.name === "string" ? profile.name.trim() : undefined,
    phone: typeof profile.phone === "string" ? profile.phone.trim() : undefined,
    address: profile.address,
    collectionSafetyMarginDays: profile.collectionSafetyMarginDays ?? profile.collectionMarginDays,
    withdrawalToleranceDays: profile.withdrawalToleranceDays ?? profile.pickupToleranceDays,
    hours: body.hours,
  };
  const hours = body.hours === undefined ? null : validateHours(body.hours);
  const now = new Date().toISOString();
  const result = await ctx.db.transact(async (transaction) => {
    const idem = await prepareIdempotency(ctx, transaction, `bank-update:${user.uid}`, idempotencyBody);
    if (idem.replay !== undefined) return idem.replay as JsonObject;
    const bank = await transaction.get(`bancas/${ctx.env.BANCA_ID}`);
    if (!bank) throw new HttpError({ code: "bank_not_found", message: "Bank profile was not found.", status: 404 });
    const storedHours = await transaction.query(`bancas/${ctx.env.BANCA_ID}/horarios`, query("horarios", [], 7));
    const updated: JsonObject = { ...bank.data, atualizadoEm: now };
    if (profile.name !== undefined) updated.nomeExibicao = requireString(profile.name, "name", 100);
    if (profile.phone !== undefined) updated.telefone = requireString(profile.phone, "phone", 32);
    if (profile.address !== undefined) updated.endereco = requireString(profile.address, "address", 500);
    const margin = profile.collectionSafetyMarginDays ?? profile.collectionMarginDays;
    if (margin !== undefined) {
      const marginDays = Number(margin);
      if (!Number.isInteger(marginDays) || marginDays < 0 || marginDays > 30) throw new HttpError({ code: "invalid_request", message: "collectionSafetyMarginDays must be between 0 and 30.", status: 400 });
      updated.margemRecolhimentoDias = marginDays;
    }
    const toleranceValue = profile.withdrawalToleranceDays ?? profile.pickupToleranceDays;
    if (toleranceValue !== undefined) {
      const tolerance = Number(toleranceValue);
      if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 30) throw new HttpError({ code: "invalid_request", message: "withdrawalToleranceDays must be between 0 and 30.", status: 400 });
      updated.toleranciaRetiradaDias = tolerance;
    }
    if (hours) {
      for (const hour of hours) {
        transaction.set(`bancas/${ctx.env.BANCA_ID}/horarios/${hour.id}`, {
          bancaId: ctx.env.BANCA_ID,
          diaSemana: hour.day,
          fechado: hour.closed,
          abre: hour.opens,
          fecha: hour.closes,
          ativo: true,
          atualizadoEm: now,
        });
      }
    }
    transaction.set(`bancas/${ctx.env.BANCA_ID}`, updated);
    const responseHours = hours
      ? hours.map((hour) => ({ dayOfWeek: hour.day, closed: hour.closed, opensAt: hour.opens, closesAt: hour.closes }))
      : Array.from({ length: 7 }, (_, day) => {
        const hour = storedHours.find((entry) => weekdayIndex(entry.data.diaSemana, entry.id) === day);
        const data = hour?.data ?? defaultOpeningHours(day);
        return { dayOfWeek: day, closed: data.fechado === true, opensAt: data.abre ?? data.horaAbertura ?? null, closesAt: data.fecha ?? data.horaFechamento ?? null };
      });
    const response = {
      profile: { name: updated.nomeExibicao, phone: updated.telefone, address: updated.endereco, collectionSafetyMarginDays: updated.margemRecolhimentoDias, withdrawalToleranceDays: updated.toleranciaRetiradaDias },
      hours: responseHours,
    };
    saveIdempotency(transaction, idem, response);
    return response;
  });
  return jsonResponse(ctx, result);
}

export async function handleAdminRoute(ctx: RequestContext): Promise<Response | null> {
  if (!ctx.url.pathname.startsWith("/api/admin/")) return null;
  const isBankConfigurationWrite = ctx.request.method === "PUT" && ctx.url.pathname === "/api/admin/banca";
  const user = await requireAdmin(ctx, isBankConfigurationWrite ? ["ADMIN"] : ["ADMIN", "OPERADOR"]);
  const { pathname } = ctx.url;

  if (ctx.request.method === "GET" && pathname === "/api/admin/dashboard") return dashboard(ctx);
  if (ctx.request.method === "GET" && pathname === "/api/admin/reservations") return getAdminReservations(ctx);
  if (ctx.request.method === "GET" && pathname === "/api/admin/repartes") return listRepartes(ctx);
  if (ctx.request.method === "GET" && pathname === "/api/admin/lists") return listLists(ctx);
  if (ctx.request.method === "GET" && pathname === "/api/admin/histories") return listHistories(ctx);
  if (ctx.request.method === "GET" && pathname === "/api/admin/banca") return getBankProfile(ctx);
  if (ctx.request.method === "PUT" && pathname === "/api/admin/banca") return updateBankProfile(ctx, user);

  const listPublish = pathname.match(/^\/api\/admin\/lists\/([A-Za-z0-9_-]+)\/publish$/);
  if (ctx.request.method === "POST" && listPublish) return publishList(ctx, user, listPublish[1]);
  const listDetail = pathname.match(/^\/api\/admin\/lists\/([A-Za-z0-9_-]+)$/);
  if (ctx.request.method === "GET" && listDetail) return getAdminList(ctx, listDetail[1]);
  if (ctx.request.method === "PUT" && listDetail) return writeList(ctx, user, listDetail[1]);
  if (ctx.request.method === "POST" && pathname === "/api/admin/lists") return writeList(ctx, user, null);

  const withdraw = pathname.match(/^\/api\/admin\/reservations\/([A-Za-z0-9_-]+)\/withdraw$/);
  if (ctx.request.method === "POST" && withdraw) return withdrawReservation(ctx, user, withdraw[1]);
  const reconciliation = pathname.match(/^\/api\/admin\/repartes\/([A-Za-z0-9_-]+)\/reconciliation$/);
  if (ctx.request.method === "GET" && reconciliation) return getReconciliation(ctx, reconciliation[1]);
  const confirmReconciliation = pathname.match(/^\/api\/admin\/repartes\/([A-Za-z0-9_-]+)\/reconcile$/);
  if (ctx.request.method === "POST" && confirmReconciliation) return reconcileReparte(ctx, user, confirmReconciliation[1]);
  return null;
}
