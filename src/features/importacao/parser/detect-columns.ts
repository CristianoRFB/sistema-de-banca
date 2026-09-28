import type { ImportColumnMap, ImportField } from "../importacao.types";

const aliases: Record<ImportField, string[]> = {
  title: ["titulo", "title", "produto", "descricao", "nome", "obra", "item"],
  volume: ["volume", "vol", "edicao", "edicao numero", "numero", "n"],
  price: ["preco", "valor", "price", "preco unitario", "venda"],
  quantity: ["quantidade", "qtd", "qtde", "estoque", "exemplares"],
  code: ["codigo", "cod", "sku", "isbn", "ean"],
  publisher: ["editora", "publisher", "fornecedor"],
  originalTitle: ["nome original", "titulo original", "original", "titulo japones"],
  returnDate: ["recolhimento", "data recolhimento", "devolucao", "data devolucao", "prazo"],
};

export function normalizeColumnName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectColumns(headers: readonly unknown[]): ImportColumnMap {
  const normalized = headers.map(normalizeColumnName);
  const result: ImportColumnMap = {};

  for (const field of Object.keys(aliases) as ImportField[]) {
    const index = normalized.findIndex((header) =>
      aliases[field].some((alias) => header === alias || header.startsWith(alias + " ")),
    );
    if (index >= 0) result[field] = index;
  }

  return result;
}

export function hasUsefulHeaders(columns: ImportColumnMap): boolean {
  return ["title", "volume", "price", "quantity", "code"].filter((key) =>
    Object.prototype.hasOwnProperty.call(columns, key),
  ).length >= 2;
}
