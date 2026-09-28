import type { OcrEngine, OcrInput, OcrOptions, OcrResult } from "./ocr-engine";
import { preprocessImage } from "./preprocess-image";

export interface TesseractEngineOptions {
  language?: string;
  langPath?: string;
  workerPath?: string;
  corePath?: string;
  cacheMethod?: "none" | "readOnly" | "write" | "refresh" | "refreshAndWrite";
  preprocess?: boolean;
}

interface TesseractWorker {
  recognize(
    input: OcrInput,
  ): Promise<{ data: { text?: string; confidence?: number } }>;
  terminate(): Promise<unknown>;
}

interface TesseractModule {
  OEM?: { LSTM_ONLY?: number };
  createWorker(
    language: string,
    oem?: number,
    options?: Record<string, unknown>,
  ): Promise<TesseractWorker>;
}

export function createTesseractOcrEngine(
  config: TesseractEngineOptions = {},
): OcrEngine {
  let workerPromise: Promise<TesseractWorker> | null = null;
  let activeProgress: OcrOptions["onProgress"];
  const language = config.language ?? "por";

  async function getWorker(): Promise<TesseractWorker> {
    if (!workerPromise) {
      workerPromise = (async () => {
        const tesseract = (await import("tesseract.js")) as unknown as TesseractModule;
        const workerOptions: Record<string, unknown> = {
          cacheMethod: config.cacheMethod ?? "write",
          langPath: config.langPath ?? "/tessdata",
          workerPath: config.workerPath ?? "/tesseract/worker.min.js",
          corePath: config.corePath ?? "/tesseract/core/",
          logger: (message: { status?: string; progress?: number }) => {
            activeProgress?.({
              status: message.status ?? "ocr",
              progress: Math.max(0, Math.min(1, message.progress ?? 0)),
            });
          },
        };
        return tesseract.createWorker(
          language,
          tesseract.OEM?.LSTM_ONLY,
          workerOptions,
        );
      })();
    }
    try {
      return await workerPromise;
    } catch (error) {
      workerPromise = null;
      throw error;
    }
  }

  return {
    async recognize(input, options = {}): Promise<OcrResult> {
      activeProgress = options.onProgress;
      const worker = await getWorker();
      const prepared =
        config.preprocess === false
          ? input
          : await preprocessImage(input as Blob | CanvasImageSource);
      const result = await worker.recognize(prepared);
      const rawConfidence = result.data.confidence ?? 0;
      return {
        text: result.data.text ?? "",
        confidence: Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence)),
      };
    },
    async dispose(): Promise<void> {
      const worker = await workerPromise?.catch(() => null);
      workerPromise = null;
      activeProgress = undefined;
      if (worker) await worker.terminate();
    },
  };
}

/** Singleton is lazy: loading Tesseract only occurs for an image or scanned PDF page. */
export const tesseractOcrEngine = createTesseractOcrEngine();
