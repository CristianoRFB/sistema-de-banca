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
  options.onProgress?.({ stage: "read", percent: 5, message: "Abrindo PDF no dispositivo" });
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const allRows: string[][] = [];
  let totalConfidence = 0;
  let ocrPages = 0;
  const ownsEngine = !options.ocrEngine;
  const engine =
    options.ocrEngine ??
    createTesseractOcrEngine({
      language: "por+eng+jpn",
      langPath: options.ocrLangPath ?? "/tessdata",
      workerPath: options.ocrWorkerPath,
      corePath: options.ocrCorePath,
    });

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      options.onProgress?.({
        stage: "pdf",
        percent: Math.round(((pageNumber - 1) / pdf.numPages) * 85),
        message: "Lendo página " + pageNumber + " de " + pdf.numPages,
      });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const extracted = textLines(content.items as unknown[]);
      const text = extracted.join("\n");

      if (text.replace(/\s/g, "").length >= 12) {
        allRows.push(...rowsFromText(text));
        totalConfidence += 1;
      } else {
        const viewport = page.getViewport({ scale: 1.8 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
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
        canvas.width = 0;
        canvas.height = 0;
      }
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
    if (ownsEngine) await engine.dispose?.();
  }

  const meanConfidence = pdf.numPages ? totalConfidence / pdf.numPages : 0;
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
      ocrPages + " de " + pdf.numPages + " página(s) exigiram OCR local; confira os dados extraídos.",
    );
  }
  return draft;
}
