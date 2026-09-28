export interface DetectedTextLine {
  text: string;
  confidence: number;
}

export function detectTableRows(text: string, confidence = 1): DetectedTextLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]+/g, " ").replace(/\s{2,}/g, "\t").trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ text: line, confidence: Math.max(0, Math.min(1, confidence)) }));
}
