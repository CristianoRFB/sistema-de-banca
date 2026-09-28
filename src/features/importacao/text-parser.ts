import type { ImportDraft, ImportOptions } from "./importacao.types";
import { createImportDraftFromRows, parseDelimitedRows } from "./excel/excel-parser";

export function parseTextImport(
  text: string,
  options: ImportOptions = {},
): ImportDraft {
  options.onProgress?.({ stage: "parse", percent: 15, message: "Interpretando texto" });
  return createImportDraftFromRows(
    parseDelimitedRows(text),
    "TEXTO",
    null,
    options,
  );
}

export function createManualImportDraft(
  lines: readonly string[],
  options: ImportOptions = {},
): ImportDraft {
  options.onProgress?.({ stage: "parse", percent: 15, message: "Montando rascunho manual" });
  return createImportDraftFromRows(
    lines.map((line) => [line]),
    "MANUAL",
    null,
    options,
  );
}
