/// <reference types="vite/client" />

import type { ImportDraft, ImportOptions } from "../importacao.types";
import { createImportDraftFromRows } from "../excel/excel-parser";
import { createTesseractOcrEngine } from "../ocr/tesseract-engine";
import { detectTableRows } from "../ocr/table-detector";

interface PositionedText {
  text: string;
  x: number;
  y: number;
}

export const PDF_IMPORT_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxPages: 30,
  maxRenderedPixelsPerPage: 8_000_000,
  maxRenderedDimension: 4096,
} as const;

const MAX_PDF_RENDER_SCALE = 1.8;

function textLines(items: readonly unknown[]): string[] {
  const positioned: PositionedText[] = [];
  for (const item of items) {
    if (
      typeof item === "object" &&
      item !== null &&
      "str" in item &&
      "transform" in item &&
      Array.isArray(item.transform)
    ) {
      const text = String(item.str ?? "").trim();
      if (!text) continue;
      positioned.push({
        text,
        x: Number(item.transform[4] ?? 0),
        y: Number(item.transform[5] ?? 0),
      });
    }
  }
  positioned.sort((left, right) => right.y - left.y || left.x - right.x);

  const lines: PositionedText[][] = [];
  for (const token of positioned) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - token.y) <= 2.5) last.push(token);
    else lines.push([token]);
  }
  return lines.map((line) => {
    line.sort((left, right) => left.x - right.x);
    let output = "";
    let previousRight = Number.NEGATIVE_INFINITY;
    for (const token of line) {
      if (output && token.x - previousRight > 32) output += "\t";
      else if (output) output += " ";
      output += token.text;
      previousRight = token.x + Math.max(5, token.text.length * 4);
    }
    return output.trim();
  });
}

function rowsFromText(text: string): string[][] {
  return detectTableRows(text)
    .map((line) => line.text.split("\t"))
    .filter((row) => row.some((cell) => cell.trim().length > 0));
}

export async function parsePdfFile(
  file: Blob & { name?: string },
  options: ImportOptions = {},
): Promise<ImportDraft> {
  if (file.size > PDF_IMPORT_LIMITS.maxFileBytes) {
    throw new Error("Este PDF é maior que 20 MB. Comprima ou divida o arquivo e tente novamente.");
  }

  options.onProgress?.({ stage: "read", percent: 5, message: "Abrindo PDF no dispositivo" });
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const allRows: string[][] = [];
  let totalConfidence = 0;
  let ocrPages = 0;
  const ownsEngine = !options.ocrEngine;
  let engine = options.ocrEngine;
  let pageCount: number;

  try {
    const pdf = await loadingTask.promise;
    pageCount = pdf.numPages;
    if (pageCount > PDF_IMPORT_LIMITS.maxPages) {
      throw new Error(
        "Este PDF tem mais de 30 páginas. Divida o arquivo em partes menores e tente novamente.",
      );
    }

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      options.onProgress?.({
        stage: "pdf",
        percent: Math.round(((pageNumber - 1) / pageCount) * 85),
        message: "Lendo página " + pageNumber + " de " + pageCount,
      });
      const page = await pdf.getPage(pageNumber);
      let canvas: HTMLCanvasElement | null = null;
      try {
        const content = await page.getTextContent();
        const extracted = textLines(content.items as unknown[]);
        const text = extracted.join("\n");

        if (text.replace(/\s/g, "").length >= 12) {
          allRows.push(...rowsFromText(text));
          totalConfidence += 1;
        } else {
          const baseViewport = page.getViewport({ scale: 1 });
          const baseWidth = baseViewport.width;
          const baseHeight = baseViewport.height;
          const basePixels = baseWidth * baseHeight;
          const longestDimension = Math.max(baseWidth, baseHeight);
          if (
            !Number.isFinite(basePixels) ||
            basePixels <= 0 ||
            !Number.isFinite(longestDimension) ||
            longestDimension <= 0
          ) {
            throw new Error("Esta página tem dimensões inválidas para processamento neste dispositivo.");
          }

          const scale = Math.min(
            MAX_PDF_RENDER_SCALE,
            Math.sqrt(PDF_IMPORT_LIMITS.maxRenderedPixelsPerPage / basePixels),
            PDF_IMPORT_LIMITS.maxRenderedDimension / longestDimension,
          );
          if (!Number.isFinite(scale) || scale <= 0) {
            throw new Error("Esta página é grande demais para processar neste dispositivo.");
          }

          const viewport = page.getViewport({ scale });
          if (
            !Number.isFinite(viewport.width) ||
            !Number.isFinite(viewport.height) ||
            viewport.width <= 0 ||
            viewport.height <= 0
          ) {
            throw new Error("Esta página tem dimensões inválidas para processamento neste dispositivo.");
          }
          const width = Math.max(1, Math.floor(viewport.width));
          const height = Math.max(1, Math.floor(viewport.height));
          if (
            width > PDF_IMPORT_LIMITS.maxRenderedDimension ||
            height > PDF_IMPORT_LIMITS.maxRenderedDimension ||
            width * height > PDF_IMPORT_LIMITS.maxRenderedPixelsPerPage
          ) {
            throw new Error("Esta página é grande demais para processar neste dispositivo.");
          }

          canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          await page.render({ canvas, viewport }).promise;
          engine ??= createTesseractOcrEngine({
            language: "por+eng+jpn",
            langPath: options.ocrLangPath ?? "/tessdata",
            workerPath: options.ocrWorkerPath,
            corePath: options.ocrCorePath,
          });
          const result = await engine.recognize(canvas, {
            onProgress: ({ status, progress }) =>
              options.onProgress?.({
                stage: "ocr",
                percent: 10 + Math.round(progress * 70),
                message: "OCR página " + pageNumber + ": " + status,
              }),
          });
          allRows.push(...rowsFromText(result.text));
          totalConfidence += result.confidence;
          ocrPages += 1;
        }
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        try {
          page.cleanup();
        } catch {
          // Keep a parse/OCR error visible even if PDF.js page cleanup fails.
        }
      }
    }
  } finally {
    const engineToDispose = ownsEngine ? engine : null;
    await Promise.allSettled([
      Promise.resolve().then(() => loadingTask.destroy()),
      ...(engineToDispose
        ? [Promise.resolve().then(() => engineToDispose.dispose?.())]
        : []),
    ]);
  }

  const meanConfidence = pageCount ? totalConfidence / pageCount : 0;
  options.onProgress?.({ stage: "review", percent: 95, message: "Criando rascunho para revisão" });
  const draft = createImportDraftFromRows(
    allRows,
    "PDF",
    file.name ?? null,
    options,
    meanConfidence,
  );
  if (ocrPages > 0) {
    draft.warnings.unshift(
      ocrPages + " de " + pageCount + " página(s) exigiram OCR local; confira os dados extraídos.",
    );
  }
  return draft;
}
