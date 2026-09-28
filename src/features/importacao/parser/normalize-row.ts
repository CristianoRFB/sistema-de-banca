import type {
  ImportColumnMap,
  ImportField,
  ImportedListRow,
  RowNormalizationOptions,
} from "../importacao.types";

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseNumber(value: string): number | null {
  const cleaned = value
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const decimalSeparator = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? /\./g : /,/g;
    normalized = cleaned.replace(groupingSeparator, "").replace(decimalSeparator, ".");
  } else {
    normalized = cleaned.replace(",", ".");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseInteger(value: string): number | null {
  const number = parseNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

function parseDate(value: string): string | null {
  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return parseDate(isoMatch[3] + "/" + isoMatch[2] + "/" + isoMatch[1]);
  }
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function makeId(line: number, values: readonly string[]): string {
  const content = values.join("|") + ":" + line;
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  }
  return "import-" + (hash >>> 0).toString(36);
}

function getCell(
  cells: readonly string[],
  columns: ImportColumnMap,
  field: ImportField,
): string {
  const index = columns[field];
  return index === undefined ? "" : clean(cells[index]);
}

function extractTitleVolume(rawTitle: string): { title: string; volume: string | null } {
  const match = rawTitle.match(/^(.*?)(?:\s+|[._-])([0-9]{1,4}(?:\s*[-/]\s*[0-9]{1,4})?)$/);
  if (!match || !match[1].trim()) return { title: rawTitle, volume: null };
  return { title: match[1].trim(), volume: match[2].replace(/\s+/g, "") };
}

export function normalizeImportedRow(
  cells: readonly unknown[],
  options: RowNormalizationOptions,
): ImportedListRow {
  const normalizedCells = cells.map(clean);
  const columns = options.columns ?? {};
  const fieldConfidence: Partial<Record<ImportField, number>> = {};
  const issues: string[] = [];
  const sourceConfidence = Math.max(0, Math.min(1, options.sourceConfidence ?? 1));
  const explicitTitle = getCell(normalizedCells, columns, "title");

  let title = explicitTitle;
  let extractedVolume: string | null = null;
  if (!title) {
    const text = options.rawText?.trim() || normalizedCells.filter(Boolean).join(" ");
    const parsed = extractTitleVolume(text);
    title = parsed.title;
    extractedVolume = parsed.volume;
  } else if (!getCell(normalizedCells, columns, "volume")) {
    const parsed = extractTitleVolume(title);
    if (parsed.volume) {
      title = parsed.title;
      extractedVolume = parsed.volume;
    }
  }
  if (title) fieldConfidence.title = sourceConfidence * (explicitTitle ? 0.98 : 0.78);
  else issues.push("Título ausente");

  const volumeCell = getCell(normalizedCells, columns, "volume");
  const volume = volumeCell || extractedVolume;
  if (volume) fieldConfidence.volume = sourceConfidence * (volumeCell ? 0.96 : 0.76);

  const priceCell = getCell(normalizedCells, columns, "price");
  const price = priceCell ? parseNumber(priceCell) : null;
  if (price !== null) fieldConfidence.price = sourceConfidence * 0.94;
  else if (priceCell) issues.push("Preço precisa ser conferido");

  const quantityCell = getCell(normalizedCells, columns, "quantity");
  const quantity = quantityCell ? parseInteger(quantityCell) : null;
  if (quantity !== null) fieldConfidence.quantity = sourceConfidence * 0.94;
  else if (quantityCell) issues.push("Quantidade precisa ser conferida");

  const code = getCell(normalizedCells, columns, "code") || null;
  const publisher = getCell(normalizedCells, columns, "publisher") || null;
  const originalTitle = getCell(normalizedCells, columns, "originalTitle") || null;
  const dateCell = getCell(normalizedCells, columns, "returnDate");
  const returnDate = dateCell ? parseDate(dateCell) : null;
  if (dateCell && !returnDate) issues.push("Data de recolhimento precisa ser conferida");
  if (dateCell && returnDate) fieldConfidence.returnDate = sourceConfidence * 0.9;

  if (code) fieldConfidence.code = sourceConfidence * 0.94;
  if (publisher) fieldConfidence.publisher = sourceConfidence * 0.9;
  if (originalTitle) fieldConfidence.originalTitle = sourceConfidence * 0.9;

  const scores = Object.values(fieldConfidence);
  const confidence = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 0;
  if (confidence < 0.72) issues.push("Baixa confiança: revise esta linha");
  if (options.line < 1) issues.push("Número da linha inválido");

  return {
    id: makeId(options.line, normalizedCells),
    line: options.line,
    title,
    volume: volume || null,
    price,
    quantity,
    code,
    publisher,
    originalTitle,
    returnDate,
    confidence,
    fieldConfidence,
    issues,
    requiresReview: true,
  };
}

export function isEmptyImportedRow(cells: readonly unknown[]): boolean {
  return cells.every((cell) => clean(cell) === "");
}

export function inferBasicColumnMap(rows: readonly (readonly unknown[])[]): ImportColumnMap {
  const first = rows.find((row) => row.some((cell) => clean(cell) !== ""));
  if (!first) return {};
  const map: ImportColumnMap = { title: 0 };
  if (first.length > 1) {
    const sample = rows.slice(0, 8).map((row) => row.map(clean));
    for (let column = 1; column < first.length; column += 1) {
      const values = sample.map((row) => row[column] ?? "").filter(Boolean);
      if (!values.length) continue;
      if (!map.price && values.some((value) => /R\$|,\d{2}$|\.\d{2}$/.test(value))) {
        map.price = column;
      } else if (values.every((value) => /^\d+$/.test(value))) {
        if (!map.volume) map.volume = column;
        else if (!map.quantity) map.quantity = column;
      }
    }
  }
  return map;
}
