import type { ExportableList } from "./exportacao.types";
import { downloadExport } from "./download";
import { generateShareMessage } from "./message-generator";

export interface ExportFile {
  blob: Blob;
  fileName: string;
}

export type ShareResult =
  | { status: "shared" }
  | { status: "cancelled" }
  | { status: "downloaded"; whatsappUrl: string; fileNames: string[] };

export function whatsappComposerUrl(message: string): string {
  return "https://wa.me/?text=" + encodeURIComponent(message);
}

export async function shareList(
  list: ExportableList,
  files: readonly ExportFile[] = [],
): Promise<ShareResult> {
  const text = generateShareMessage(list);
  const shareData: ShareData = {
    title: list.title,
    text,
  };
  if (files.length) {
    shareData.files = files.map(
      (file) => new File([file.blob], file.fileName, { type: file.blob.type }),
    );
  }

  const canShareFiles =
    !files.length ||
    (typeof navigator.canShare === "function" && navigator.canShare({ files: shareData.files }));
  if (typeof navigator.share === "function" && canShareFiles) {
    try {
      await navigator.share(shareData);
      return { status: "shared" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { status: "cancelled" };
      }
    }
  }

  for (const file of files) downloadExport(file.blob, file.fileName);
  return {
    status: "downloaded",
    whatsappUrl: whatsappComposerUrl(text),
    fileNames: files.map((file) => file.fileName),
  };
}
