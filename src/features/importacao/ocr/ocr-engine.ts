export interface OcrResult {
  text: string;
  confidence: number;
}

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrOptions {
  onProgress?: (progress: OcrProgress) => void;
}

export type OcrInput = Blob | File | CanvasImageSource;

export interface OcrEngine {
  recognize(input: OcrInput, options?: OcrOptions): Promise<OcrResult>;
  dispose?(): Promise<void>;
}
