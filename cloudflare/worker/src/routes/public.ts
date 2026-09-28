import { compare, eq, firestoreString, jsonResponse, parseLimit, query } from "../api";
import { defaultOpeningHours, MAX_CATALOG_PAGE_SIZE } from "../domain";
import { hashClientSessionToken, maskPhone, normalizeName, rateLimit } from "../security";
import { HttpError, type RequestContext } from "../types";

const ALLOWED_PRODUCT_TYPES = new Set(["MANGA", "REVISTA", "BOX", "COLECIONAVEL", "OUTRO"]);
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeCursor(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    result += BASE64[a >> 2];
    result += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) result += BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) result += BASE64[c & 63];
  }
  return result;
}

function decodeCursor(value: string): unknown {
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  try { return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as unknown; } catch {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
}

async function makeCatalogCursor(ctx: RequestContext, id: string, value: string, sort: string): Promise<string> {
  const signature = await hashClientSessionToken(ctx.env, `catalog-cursor:v1:${sort}:${value}:${id}`);
  return encodeCursor({ id, value, sort, signature });
}

async function readCatalogCursor(ctx: RequestContext, value: string | null, sort: string): Promise<{ id: string; value: string } | null> {
  if (!value) return null;
  const decoded = decodeCursor(value);
  if (typeof decoded !== "object" || decoded === null || typeof (decoded as { id?: unknown }).id !== "string" || typeof (decoded as { value?: unknown }).value !== "string" || typeof (decoded as { sort?: unknown }).sort !== "string" || typeof (decoded as { signature?: unknown }).signature !== "string") {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
  const { id, value: cursorValue, sort: cursorSort, signature } = decoded as { id: string; value: string; sort: string; signature: string };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || cursorSort !== sort || signature !== await hashClientSessionToken(ctx.env, `catalog-cursor:v1:${sort}:${cursorValue}:${id}`)) {
    throw new HttpError({ code: "invalid_cursor", message: "cursor is invalid.", status: 400 });
  }
  return { id, value: cursorValue };
}

function weekdayIndex(value: unknown): number | null {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
  const name = normalizeName(String(value ?? ""));
  const days = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const index = days.indexOf(name);
  return index < 0 ? null : index;
}

export async function handlePublicRoute(ctx: RequestContext): Promise<Response | null> {
  const { pathname, searchParams } = ctx.url;

  if (ctx.request.method === "GET" && pathname === "/api/public/banca") {
    const document = await ctx.db.get(`bancas/${ctx.env.BANCA_ID}`);
    if (!document || document.data.ativo === false) throw new HttpError({ code: "bank_not_found", message: "Public bank profile was not found.", status: 404 });
    const storedHours = await ctx.db.query(`bancas/${ctx.env.BANCA_ID}/horarios`, {
      from: [{ collectionId: "horarios" }],
      orderBy: [{ field: { fieldPath: "diaSemana" }, direction: "ASCENDING" }],
      limit: 7,
    });
    return jsonResponse(ctx, {
      profile: {
        name: document.data.nomeExibicao ?? null,
        slug: document.data.slug ?? null,
        phone: document.data.telefone ?? null,
        address: document.data.endereco ?? null,
        photoUrl: document.data.fotoFixaUrl ?? null,
      },
      hours: Array.from({ length: 7 }, (_, day) => {
        const entry = storedHours.find((candidate) => weekdayIndex(candidate.data.diaSemana) === day);
        const data = entry?.data ?? defaultOpeningHours(day);
        return {
          dayOfWeek: day,
          closed: data.fechado === true,
          opensAt: data.abre ?? data.horaAbertura ?? null,
          closesAt: data.fecha ?? data.horaFechamento ?? null,
        };
      }),
    });
  }

  if (ctx.request.method === "GET" && pathname === "/api/public/profile") {
    await rateLimit(ctx, "public-search");
    const name = searchParams.get("name") ?? "";
    const normalized = normalizeName(name);
    if (normalized.length < 3 || normalized.length > 80) throw new HttpError({ code: "invalid_name_query", message: "name must contain 3 to 80 characters.", status: 400 });
    const documents = await ctx.db.query("clientes", query("clientes", [
      eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
      compare("nomeNormalizado", "GREATER_THAN_OR_EQUAL", firestoreString(normalized)),
      compare("nomeNormalizado", "LESS_THAN_OR_EQUAL", firestoreString(`${normalized}\uf8ff`)),
      eq("ativo", { booleanValue: true }),
    ], 11, [{ field: { fieldPath: "nomeNormalizado" }, direction: "ASCENDING" }]));
    return jsonResponse(ctx, {
      profiles: documents.slice(0, 10).map((document) => ({
        id: document.id,
        name: String(document.data.nome ?? ""),
        maskedPhone: maskPhone(String(document.data.telefone ?? "")),
      })),
      hasMore: documents.length > 10,
    });
  }

  if (ctx.request.method === "GET" && pathname === "/api/public/catalog") {
    const limit = parseLimit(searchParams.get("limit"), 20, MAX_CATALOG_PAGE_SIZE);
    const nameQuery = (searchParams.get("q") ?? "").trim().slice(0, 100).toLocaleLowerCase("pt-BR");
    const productType = (searchParams.get("type") ?? "").trim().toUpperCase();
    if (productType && !ALLOWED_PRODUCT_TYPES.has(productType)) throw new HttpError({ code: "invalid_product_type", message: "type is not supported.", status: 400 });
    const sort = (searchParams.get("sort") ?? "recent").toLowerCase();
    if (!new Set(["recent", "title"]).has(sort)) throw new HttpError({ code: "invalid_sort", message: "sort must be recent or title.", status: 400 });
    const availabilityFilter = (searchParams.get("availability") ?? "all").toLowerCase();
    if (!new Set(["all", "available", "low"]).has(availabilityFilter)) throw new HttpError({ code: "invalid_availability", message: "availability must be all, available, or low.", status: 400 });
    const cursor = await readCatalogCursor(ctx, searchParams.get("cursor"), sort);
    const listingFilters = [
      eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
      eq("ativo", { booleanValue: true }),
      ...(availabilityFilter === "all" ? [] : [eq("availabilityClass", firestoreString(availabilityFilter === "low" ? "LOW" : "AVAILABLE"))]),
    ];
    const orderBy = sort === "title"
      ? [{ field: { fieldPath: "tituloExibicao" }, direction: "ASCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }]
      : [{ field: { fieldPath: "publicadoEm" }, direction: "DESCENDING" }, { field: { fieldPath: "__name__" }, direction: "ASCENDING" }];
    const startValues = cursor ? [
      firestoreString(cursor.value),
      { referenceValue: `projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/itensLista/${cursor.id}` },
    ] : null;

    const structuredQuery = query("itensLista", listingFilters, limit + 1, orderBy, startValues ? {
      values: startValues,
      before: false,
    } : undefined);
    const listed = await ctx.db.query("itensLista", structuredQuery);
    const pageSource = listed.slice(0, limit);
    const listIds = [...new Set(listed.map((item) => String(item.data.listaId ?? "")).filter(Boolean))];
    const itemReparteIds = [...new Set(listed.map((item) => String(item.data.itemReparteId ?? "")).filter(Boolean))];
    const productIds = [...new Set(listed.map((item) => String(item.data.produtoId ?? "")).filter(Boolean))];
    const lists = await ctx.db.batchGet(listIds.map((id) => `listas/${id}`));
    const inventory = await ctx.db.batchGet(itemReparteIds.map((id) => `itensReparte/${id}`));
    const products = await ctx.db.batchGet(productIds.map((id) => `produtos/${id}`));
    const reparteIds = [...new Set([...inventory.values()].map((item) => String(item.data.reparteId ?? "")).filter(Boolean))];
    const repartes = await ctx.db.batchGet(reparteIds.map((id) => `repartes/${id}`));
    const byAbsoluteName = (map: Map<string, { id: string; data: Record<string, unknown> }>, collection: string, id: string) => map.get(`projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${id}`);

    const projected = pageSource.flatMap((item) => {
      const listId = String(item.data.listaId ?? "");
      const itemReparteId = String(item.data.itemReparteId ?? "");
      const productId = String(item.data.produtoId ?? "");
      const list = byAbsoluteName(lists, "listas", listId);
      const stock = byAbsoluteName(inventory, "itensReparte", itemReparteId);
      const product = byAbsoluteName(products, "produtos", productId);
      const reparteId = String(stock?.data.reparteId ?? "");
      const reparte = byAbsoluteName(repartes, "repartes", reparteId);
      if (!list || !stock || !product || !reparte || list.data.status !== "PUBLICADA" || list.data.bancaId !== ctx.env.BANCA_ID || stock.data.bancaId !== ctx.env.BANCA_ID || stock.data.status === "ARQUIVADO" || reparte.data.status !== "ATIVO") return [];
      const received = Number(stock.data.quantidadeRecebida ?? 0);
      const reserved = Number(stock.data.quantidadeReservada ?? 0);
      const withdrawn = Number(stock.data.quantidadeRetirada ?? 0);
      const returned = Number(stock.data.quantidadeDevolvida ?? 0);
      const positive = Number(stock.data.quantidadeAjustePositivo ?? 0);
      const negative = Number(stock.data.quantidadeAjusteNegativo ?? 0);
      const available = Math.max(0, received + positive - reserved - withdrawn - returned - negative);
      const title = String(item.data.tituloExibicao ?? stock.data.tituloSnapshot ?? product.data.titulo ?? "");
      const volume = item.data.volumeExibicao ?? stock.data.volumeSnapshot ?? product.data.volume ?? null;
      const type = String(product.data.tipo ?? "OUTRO").toUpperCase();
      if (nameQuery && !`${title} ${String(volume ?? "")}`.toLocaleLowerCase("pt-BR").includes(nameQuery)) return [];
      if (productType && type !== productType) return [];
      if (availabilityFilter === "available" && available <= 0) return [];
      if (availabilityFilter === "low" && (available <= 0 || available > 3)) return [];
      return [{
        id: item.id,
        listId,
        itemReparteId,
        productId,
        title,
        volume,
        type,
        publisher: product.data.editora ?? null,
        price: item.data.precoExibicao ?? stock.data.precoVenda ?? null,
        available,
        publishedAt: list.data.publicadaEm ?? null,
        reservationCutoffAt: stock.data.dataFimReservas ?? reparte.data.dataFimReservas ?? null,
        plannedCollectionAt: stock.data.dataRecolhimentoOverride ?? reparte.data.dataRecolhimentoPrevista ?? null,
        status: available > 0 ? "AVAILABLE" : "SOLD_OUT",
      _order: item.id,
      _cursorValue: sort === "title" ? String(item.data.tituloExibicao ?? "") : String(item.data.publicadoEm ?? ""),
    }];
    });

    const hasMore = listed.length > limit;
    let nextCursor: string | null = null;
    if (hasMore && pageSource.length) {
      const cursorDoc = pageSource.at(-1)!;
      const cursorValue = sort === "title" ? String(cursorDoc.data.tituloExibicao ?? "") : sort === "recent" ? String(cursorDoc.data.publicadoEm ?? "") : "";
      nextCursor = await makeCatalogCursor(ctx, cursorDoc.id, cursorValue, sort);
    }
    return jsonResponse(ctx, {
      items: projected.map(({ _order: _ignored, _cursorValue: _cursor, ...item }) => item),
      page: { limit, nextCursor, hasMore },
      filters: { q: nameQuery, type: productType || null, sort, availability: availabilityFilter },
    });
  }

  const catalogItemMatch = pathname.match(/^\/api\/public\/catalog\/([A-Za-z0-9_-]+)$/);
  if (ctx.request.method === "GET" && catalogItemMatch) {
    const itemReparteId = catalogItemMatch[1];
    const rows = await ctx.db.query("itensLista", query("itensLista", [
      eq("bancaId", firestoreString(ctx.env.BANCA_ID)),
      eq("itemReparteId", firestoreString(itemReparteId)),
      eq("ativo", { booleanValue: true }),
    ], 10));
    const publicRows = rows.filter((item) => typeof item.data.listaId === "string");
    const lists = await ctx.db.batchGet([...new Set(publicRows.map((item) => String(item.data.listaId)))].map((id) => `listas/${id}`));
    const selected = publicRows.find((item) => {
      const path = `projects/${ctx.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/listas/${String(item.data.listaId)}`;
      const list = lists.get(path);
      return list?.data.status === "PUBLICADA" && list.data.bancaId === ctx.env.BANCA_ID;
    });
    if (!selected) throw new HttpError({ code: "catalog_item_not_found", message: "Published catalog item was not found.", status: 404 });
    const [stock, product] = await Promise.all([
      ctx.db.get(`itensReparte/${itemReparteId}`),
      typeof selected.data.produtoId === "string" ? ctx.db.get(`produtos/${selected.data.produtoId}`) : Promise.resolve(null),
    ]);
    const reparte = stock?.data.reparteId ? await ctx.db.get(`repartes/${String(stock.data.reparteId)}`) : null;
    if (!stock || stock.data.bancaId !== ctx.env.BANCA_ID || !product || product.data.ativo === false || !reparte || reparte.data.bancaId !== ctx.env.BANCA_ID || reparte.data.status !== "ATIVO") {
      throw new HttpError({ code: "catalog_item_not_found", message: "Published catalog item was not found.", status: 404 });
    }
    const available = Math.max(0,
      Number(stock.data.quantidadeRecebida ?? 0) + Number(stock.data.quantidadeAjustePositivo ?? 0) -
      Number(stock.data.quantidadeReservada ?? 0) - Number(stock.data.quantidadeRetirada ?? 0) -
      Number(stock.data.quantidadeDevolvida ?? 0) - Number(stock.data.quantidadeAjusteNegativo ?? 0));
    return jsonResponse(ctx, {
      item: {
        id: selected.id,
        listId: selected.data.listaId,
        itemReparteId,
        productId: selected.data.produtoId,
        title: selected.data.tituloExibicao ?? stock.data.tituloSnapshot ?? product.data.titulo ?? "",
        volume: selected.data.volumeExibicao ?? stock.data.volumeSnapshot ?? product.data.volume ?? null,
        type: product.data.tipo ?? "OUTRO",
        publisher: product.data.editora ?? null,
        price: selected.data.precoExibicao ?? stock.data.precoVenda ?? null,
        available,
        publishedAt: selected.data.publicadoEm ?? null,
        reservationCutoffAt: stock.data.dataFimReservas ?? reparte.data.dataFimReservas ?? null,
        plannedCollectionAt: stock.data.dataRecolhimentoOverride ?? reparte.data.dataRecolhimentoPrevista ?? null,
        status: available > 0 ? "AVAILABLE" : "SOLD_OUT",
      },
    });
  }

  return null;
}
