import { createImportDraftFromRows } from "./excel/excel-parser";
import type { ImportDraft, ImportOptions } from "./importacao.types";
import { detectTableRows } from "./ocr/table-detector";
import { createTesseractOcrEngine } from "./ocr/tesseract-engine";

export async function parseImageFile(
  file: Blob & { name?: string },
  options: ImportOptions = {},
): Promise<ImportDraft> {
  const ownsEngine = !options.ocrEngine;
  const engine =
    options.ocrEngine ??
    createTesseractOcrEngine({
      language: "por+eng+jpn",
      langPath: options.ocrLangPath ?? "/tessdata",
      workerPath: options.ocrWorkerPath,
      corePath: options.ocrCorePath,
      preprocess: !options.preprocessImage,
    });

  options.onProgress?.({ stage: "ocr", percent: 5, message: "Preparando imagem no dispositivo" });
  try {
    const input = options.preprocessImage
      ? await options.preprocessImage(file)
      : file;
    const result = await engine.recognize(input, {
      onProgress: ({ status, progress }) =>
        options.onProgress?.({
          stage: "ocr",
          percent: Math.round(progress * 85),
          message: status,
        }),
    });
    const rows = detectTableRows(result.text, result.confidence).map((line) =>
      line.text.split("\t"),
    );
    options.onProgress?.({ stage: "review", percent: 92, message: "Criando rascunho para revisão" });
    return createImportDraftFromRows(
      rows,
      "FOTO",
      file.name ?? null,
      options,
      result.confidence,
    );
  } finally {
    if (ownsEngine) await engine.dispose?.();
  }
}
