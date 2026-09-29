import type { TipoProduto } from "../../domain/enums/TipoProduto";

export type ImportSource =
  | "FOTO"
  | "PDF"
  | "EXCEL"
  | "CSV"
  | "TEXTO"
  | "MANUAL";

export type ImportField =
  | "title"
  | "volume"
  | "price"
  | "quantity"
  | "code"
  | "publisher"
  | "originalTitle"
  | "returnDate";

export type ImportColumnMap = Partial<Record<ImportField, number>>;

export interface ImportedListRow {
  id: string;
  /** Stable inventory identity used by the admin list-save API. */
  itemReparteId?: string;
  productId?: string;
  line: number;
  title: string;
  volume: string | null;
  price: number | null;
  quantity: number | null;
  code: string | null;
  publisher: string | null;
  originalTitle: string | null;
  returnDate: string | null;
  confidence: number;
  fieldConfidence: Partial<Record<ImportField, number>>;
  issues: string[];
  requiresReview: boolean;
  type?: TipoProduto;
}

export interface ImportDraft {
  id: string;
  source: ImportSource;
  sourceName: string | null;
  status: "RASCUNHO";
  createdAt: string;
  rows: ImportedListRow[];
  warnings: string[];
  requiresHumanReview: true;
}

export interface RowNormalizationOptions {
  line: number;
  columns?: ImportColumnMap;
  sourceConfidence?: number;
  rawText?: string;
}

export type ImportProgress = (progress: {
  stage: string;
  percent: number;
  message?: string;
}) => void;

export interface ImportOptions {
  onProgress?: ImportProgress;
  /** Used to host Tesseract's language data from the app's own origin. */
  ocrLangPath?: string;
  ocrWorkerPath?: string;
  ocrCorePath?: string;
  /** Dependency injection point for testing or an alternate local OCR engine. */
  ocrEngine?: import("./ocr/ocr-engine").OcrEngine;
  /** Override the image preprocessing step for a specific app deployment. */
  preprocessImage?: (image: Blob) => Promise<CanvasImageSource>;
}
