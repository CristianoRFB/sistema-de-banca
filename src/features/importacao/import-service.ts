import type { ImportDraft, ImportOptions } from "./importacao.types";
import { parseCsvFile, parseExcelFile } from "./excel/excel-parser";
import { parseImageFile } from "./image-parser";
import { parsePdfFile } from "./pdf/pdf-parser";
import { parseTextImport } from "./text-parser";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

export async function parseImportFile(
  file: File,
  options: ImportOptions = {},
): Promise<ImportDraft> {
  const fileExtension = extension(file.name);
  const mime = file.type.toLowerCase();

  if (mime === "application/pdf" || fileExtension === ".pdf") {
    return parsePdfFile(file, options);
  }
  if (mime === "text/csv" || fileExtension === ".csv") {
    return parseCsvFile(file, options);
  }
  if (fileExtension === ".xls") {
    throw new Error("Arquivos .xls antigos não são suportados. Salve a planilha como .xlsx ou .csv.");
  }
  if (
    mime.includes("spreadsheetml") ||
    fileExtension === ".xlsx"
  ) {
    return parseExcelFile(file, options);
  }
  if (imageExtensions.has(fileExtension) || mime.startsWith("image/")) {
    return parseImageFile(file, options);
  }
  if (mime.startsWith("text/") || [".txt", ".tsv"].includes(fileExtension)) {
    options.onProgress?.({ stage: "read", percent: 10, message: "Lendo texto localmente" });
    return parseTextImport(await file.text(), options);
  }
  throw new Error("Formato não suportado. Use imagem, PDF, XLSX, CSV ou TXT.");
}
