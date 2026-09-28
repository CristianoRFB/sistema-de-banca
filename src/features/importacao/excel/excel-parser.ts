import type {
  ImportColumnMap,
  ImportDraft,
  ImportOptions,
  ImportSource,
} from "../importacao.types";
import { detectColumns, hasUsefulHeaders } from "../parser/detect-columns";
import {
  inferBasicColumnMap,
  isEmptyImportedRow,
  normalizeImportedRow,
} from "../parser/normalize-row";

export type TabularCell = string | number | boolean | Date | null | undefined;
export type TabularRows = readonly (readonly TabularCell[])[];

function countUnquoted(text: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      count += 1;
    }
  }
  return count;
}

export function parseDelimitedRows(text: string): string[][] {
  const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiters = ["\t", ";", ","];
  let delimiter = "\t";
  let bestScore = 0;
  for (const candidate of delimiters) {
    const counts = nonEmptyLines.map((line) => countUnquoted(line, candidate));
    const matchingLines = counts.filter((count) => count > 0).length;
    // A lone comma in a free-text title should not turn a multi-line list into CSV.
    if (nonEmptyLines.length > 1 && matchingLines === 1) continue;
    const score = matchingLines * 100 + counts.reduce((sum, count) => sum + count, 0);
    if (score > bestScore) {
      bestScore = score;
      delimiter = candidate;
    }
  }
  if (bestScore === 0) delimiter = "";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && delimiter && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function createImportDraftFromRows(
  sourceRows: TabularRows,
  source: ImportSource,
  sourceName: string | null = null,
  options: ImportOptions = {},
  sourceConfidence = 1,
): ImportDraft {
  const rows = sourceRows.map((row) => row.map((cell) => String(cell ?? "")));
  let headerIndex = -1;
  let columns: ImportColumnMap = {};
  for (let index = 0; index < Math.min(rows.length, 8); index += 1) {
    const candidate = detectColumns(rows[index]);
    if (hasUsefulHeaders(candidate)) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }

  const data = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  if (headerIndex < 0) columns = inferBasicColumnMap(rows);
  const normalizedRows = data
    .map((cells, index) => ({ cells, line: headerIndex >= 0 ? headerIndex + index + 2 : index + 1 }))
    .filter(({ cells }) => !isEmptyImportedRow(cells))
    .map(({ cells, line }) =>
      normalizeImportedRow(cells, {
        line,
        columns,
        sourceConfidence,
      }),
    );

  const warnings: string[] = [];
  if (normalizedRows.length === 0) warnings.push("Nenhuma linha de produto foi encontrada.");
  if (normalizedRows.some((row) => row.issues.length > 0)) {
    warnings.push("Há linhas com dados ausentes ou de baixa confiança para revisar.");
  }
  options.onProgress?.({
    stage: "review",
    percent: 100,
    message: normalizedRows.length + " linha(s) para revisão humana",
  });

  return {
    id: createDraftId(),
    source,
    sourceName,
    status: "RASCUNHO",
    createdAt: new Date().toISOString(),
    rows: normalizedRows,
    warnings,
    requiresHumanReview: true,
  };
}

function createDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "import-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

export async function parseCsvFile(
  file: Blob & { name?: string },
  options: ImportOptions = {},
): Promise<ImportDraft> {
  options.onProgress?.({ stage: "read", percent: 10, message: "Lendo arquivo CSV" });
  const text = await file.text();
  return createImportDraftFromRows(
    parseDelimitedRows(text),
    "CSV",
    file.name ?? null,
    options,
  );
}

export async function parseExcelFile(
  file: Blob & { name?: string },
  options: ImportOptions = {},
): Promise<ImportDraft> {
  options.onProgress?.({ stage: "read", percent: 10, message: "Lendo planilha localmente" });
  const buffer = await file.arrayBuffer();
  const exceljs = await import("exceljs");
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return createImportDraftFromRows([], "EXCEL", file.name ?? null, options);
  }
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    matrix.push(
      Array.from({ length: sheet.columnCount }, (_, index) => {
        const cell = row.getCell(index + 1);
        const numericFormat = cell.numFmt ?? "";
        if (typeof cell.value === "number" && /^0{2,}$/.test(numericFormat)) {
          return String(Math.trunc(cell.value)).padStart(numericFormat.length, "0");
        }
        return cell.text.trim();
      }),
    );
  });
  options.onProgress?.({ stage: "parse", percent: 75, message: "Interpretando linhas" });
  return createImportDraftFromRows(matrix, "EXCEL", file.name ?? null, options);
}
