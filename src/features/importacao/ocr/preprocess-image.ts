export interface ImagePreprocessOptions {
  maxDimension?: number;
  contrast?: number;
  threshold?: number;
}

function dimensions(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof SVGImageElement) {
    return { width: source.width.baseVal.value, height: source.height.baseVal.value };
  }
  if ("width" in source && "height" in source) {
    const { width, height } = source;
    if (typeof width === "number" && typeof height === "number") return { width, height };
  }
  if ("displayWidth" in source && "displayHeight" in source) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  throw new Error("Este tipo de imagem não pode ser processado neste navegador.");
}

export async function preprocessImage(
  image: Blob | CanvasImageSource,
  options: ImagePreprocessOptions = {},
): Promise<HTMLCanvasElement> {
  let source: CanvasImageSource;
  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;
  if (image instanceof Blob) {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(image);
      source = bitmap;
    } else {
      const element = document.createElement("img");
      objectUrl = URL.createObjectURL(image);
      element.src = objectUrl;
      await element.decode();
      source = element;
    }
  } else {
    source = image;
  }
  try {
    const { width, height } = dimensions(source);
    if (width < 1 || height < 1) throw new Error("A imagem não possui dimensões válidas.");
    const maxDimension = options.maxDimension ?? 2600;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Não foi possível preparar a imagem para OCR.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const contrast = options.contrast ?? 1.28;
    const threshold = options.threshold;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = Math.round(
        0.299 * pixels.data[index] +
          0.587 * pixels.data[index + 1] +
          0.114 * pixels.data[index + 2],
      );
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
      const value = threshold === undefined ? adjusted : adjusted >= threshold ? 255 : 0;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
