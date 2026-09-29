import { afterEach, describe, expect, it, vi } from "vitest";
import type { OcrEngine } from "../../src/features/importacao/ocr/ocr-engine";

const { getDocument, globalWorkerOptions, createOcrEngine, ownedEngine } = vi.hoisted(() => {
  const ownedEngine = {
    recognize: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    getDocument: vi.fn(),
    globalWorkerOptions: { workerSrc: "" },
    createOcrEngine: vi.fn(() => ownedEngine),
    ownedEngine,
  };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: globalWorkerOptions,
  getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/pdf-worker.mjs" }));
vi.mock("../../src/features/importacao/ocr/tesseract-engine", () => ({
  createTesseractOcrEngine: createOcrEngine,
}));

import {
  parsePdfFile,
  PDF_IMPORT_LIMITS,
} from "../../src/features/importacao/pdf/pdf-parser";

function makeFile(size = 4): Blob & { name: string } {
  return Object.assign(new Blob([new Uint8Array(size)], { type: "application/pdf" }), {
    name: "lista.pdf",
  });
}

function setPdfTask(pdf: unknown, destroy = vi.fn().mockResolvedValue(undefined)) {
  const task = { promise: Promise.resolve(pdf), destroy };
  getDocument.mockReturnValue(task);
  return task;
}

function makePage(options: {
  width?: number;
  height?: number;
  items?: unknown[];
  render?: (canvas: HTMLCanvasElement) => void;
  cleanup?: () => void;
} = {}) {
  return {
    getTextContent: vi.fn().mockResolvedValue({ items: options.items ?? [] }),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: (options.width ?? 600) * scale,
      height: (options.height ?? 800) * scale,
    })),
    render: vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
      options.render?.(canvas);
      return { promise: Promise.resolve() };
    }),
    cleanup: vi.fn(() => options.cleanup?.()),
  };
}

function makeEngine(overrides: Partial<OcrEngine> = {}): OcrEngine {
  return {
    recognize: vi.fn().mockResolvedValue({ text: "Wistoria 09", confidence: 0.9 }),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  getDocument.mockReset();
  createOcrEngine.mockReset();
  ownedEngine.recognize.mockReset();
  ownedEngine.dispose.mockReset();
  globalWorkerOptions.workerSrc = "";
});

describe("importação local de PDF", () => {
  it("recusa arquivos acima do limite antes de ler o conteúdo", async () => {
    const arrayBuffer = vi.fn();
    const largeFile = {
      size: PDF_IMPORT_LIMITS.maxFileBytes + 1,
      name: "grande.pdf",
      arrayBuffer,
    } as unknown as Blob & { name: string };

    await expect(parsePdfFile(largeFile)).rejects.toThrow(
      "Este PDF é maior que 20 MB. Comprima ou divida o arquivo e tente novamente.",
    );

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("recusa PDFs com páginas demais e libera o carregamento", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    setPdfTask({ numPages: PDF_IMPORT_LIMITS.maxPages + 1 }, destroy);

    await expect(parsePdfFile(makeFile())).rejects.toThrow(
      "Este PDF tem mais de 30 páginas. Divida o arquivo em partes menores e tente novamente.",
    );

    expect(destroy).toHaveBeenCalledOnce();
  });

  it("reduz o render de páginas enormes para respeitar limites de pixels", async () => {
    let renderedSize = { width: 0, height: 0 };
    const page = makePage({
      width: 20_000,
      height: 12_000,
      render: (canvas) => { renderedSize = { width: canvas.width, height: canvas.height }; },
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    const engine = makeEngine();
    setPdfTask({ numPages: 1, getPage: vi.fn().mockResolvedValue(page) }, destroy);

    const draft = await parsePdfFile(makeFile(), { ocrEngine: engine });

    expect(renderedSize.width).toBeLessThanOrEqual(PDF_IMPORT_LIMITS.maxRenderedDimension);
    expect(renderedSize.height).toBeLessThanOrEqual(PDF_IMPORT_LIMITS.maxRenderedDimension);
    expect(renderedSize.width * renderedSize.height).toBeLessThanOrEqual(
      PDF_IMPORT_LIMITS.maxRenderedPixelsPerPage,
    );
    expect(engine.recognize).toHaveBeenCalledOnce();
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(draft.source).toBe("PDF");
  });

  it("limpa canvas, página e documento mesmo quando OCR e a limpeza falham", async () => {
    let canvas: HTMLCanvasElement | undefined;
    const originalError = new Error("OCR falhou");
    const page = makePage({
      render: (target) => { canvas = target; },
      cleanup: () => { throw new Error("page cleanup falhou"); },
    });
    const destroy = vi.fn().mockRejectedValue(new Error("PDF cleanup falhou"));
    const engine = makeEngine({
      recognize: vi.fn().mockRejectedValue(originalError),
      dispose: vi.fn().mockRejectedValue(new Error("OCR cleanup falhou")),
    });
    setPdfTask({ numPages: 1, getPage: vi.fn().mockResolvedValue(page) }, destroy);

    await expect(parsePdfFile(makeFile(), { ocrEngine: engine })).rejects.toBe(originalError);

    expect(canvas?.width).toBe(0);
    expect(canvas?.height).toBe(0);
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(engine.dispose).not.toHaveBeenCalled();
  });

  it("libera o motor OCR que cria quando o reconhecimento falha", async () => {
    const originalError = new Error("OCR falhou");
    const page = makePage();
    const destroy = vi.fn().mockResolvedValue(undefined);
    ownedEngine.recognize.mockRejectedValue(originalError);
    ownedEngine.dispose.mockRejectedValue(new Error("liberação falhou"));
    createOcrEngine.mockReturnValue(ownedEngine);
    setPdfTask({ numPages: 1, getPage: vi.fn().mockResolvedValue(page) }, destroy);

    await expect(parsePdfFile(makeFile())).rejects.toBe(originalError);

    expect(ownedEngine.dispose).toHaveBeenCalledOnce();
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
