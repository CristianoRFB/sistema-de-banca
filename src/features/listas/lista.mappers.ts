import { TipoProduto, type TipoProduto as TipoProdutoValue } from "../../domain/enums/TipoProduto";
import type { ImportedListRow } from "../importacao/importacao.types";
import type { ItemListaAdmin } from "../admin/admin.repository";

const PRODUCT_TYPES = new Set<string>(Object.values(TipoProduto));

export function asTipoProduto(value: unknown): TipoProdutoValue {
  return typeof value === "string" && PRODUCT_TYPES.has(value)
    ? value as TipoProdutoValue
    : TipoProduto.MANGA;
}

function rowKey(title: string, volume: string | null | undefined): string {
  return `${title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR")}\u0000${volume ?? ""}`;
}

export function mapAdminItemsToImportedRows(items: readonly ItemListaAdmin[]): ImportedListRow[] {
  return items.filter((item) => item.active !== false).map((item, index) => ({
    id: item.id,
    itemReparteId: item.itemReparteId,
    productId: item.productId,
    line: index + 1,
    title: item.title,
    type: asTipoProduto(item.type),
    volume: item.volume ?? null,
    price: item.price ?? null,
    quantity: item.quantity ?? null,
    code: item.code ?? null,
    publisher: item.publisher ?? null,
    originalTitle: item.originalTitle ?? null,
    returnDate: item.returnDate ?? null,
    confidence: item.confidence ?? 1,
    fieldConfidence: {},
    issues: item.issues ?? [],
    requiresReview: item.requiresReview ?? true,
  }));
}

/**
 * Reattaches server identities after a draft save. The Worker returns rows in
 * list order. Existing stock IDs are preferred; title/volume matching covers
 * newly added rows and old local drafts that predate identity persistence.
 */
export function attachSavedItemIdentities(
  rows: readonly ImportedListRow[],
  savedItems: readonly ItemListaAdmin[],
): ImportedListRow[] {
  const available = savedItems.filter((item) => item.active !== false);
  const used = new Set<string>();
  const byKey = new Map<string, ItemListaAdmin[]>();
  for (const item of available) {
    const key = rowKey(item.title, item.volume);
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }

  return rows.map((row) => {
    const existing = row.itemReparteId
      ? available.find((item) => item.itemReparteId === row.itemReparteId)
      : undefined;
    const candidates = byKey.get(rowKey(row.title, row.volume)) ?? [];
    const matched = (existing && !used.has(existing.id) ? existing : undefined) ?? candidates.find((item) => !used.has(item.id));
    if (!matched) return row;
    used.add(matched.id);
    return {
      ...row,
      id: matched.id,
      itemReparteId: matched.itemReparteId,
      productId: matched.productId,
    };
  });
}

export function hasCompleteSavedItemIdentities(
  rows: readonly ImportedListRow[],
  savedItems: readonly ItemListaAdmin[],
): boolean {
  const activeItems = savedItems.filter((item) => item.active !== false);
  const stockIds = rows.map((row) => row.itemReparteId);
  const rowIds = rows.map((row) => row.id);
  return activeItems.length === rows.length &&
    rows.every((row) => Boolean(row.itemReparteId && row.productId)) &&
    new Set(stockIds).size === rows.length &&
    new Set(rowIds).size === rows.length;
}

export function toAdminListItemInput(row: ImportedListRow) {
  return {
    ...(row.itemReparteId ? { itemReparteId: row.itemReparteId } : {}),
    ...(row.productId ? { productId: row.productId } : {}),
    title: row.title.trim(),
    volume: row.volume,
    price: row.price,
    quantity: row.quantity,
    code: row.code,
    publisher: row.publisher,
    originalTitle: row.originalTitle,
    returnDate: row.returnDate,
    type: row.type ?? TipoProduto.MANGA,
    confidence: row.confidence,
    fieldConfidence: row.fieldConfidence,
    issues: row.issues,
    requiresReview: row.requiresReview,
  };
}
