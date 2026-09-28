export interface ExportableListItem {
  title: string;
  volume?: string | null;
  price?: number | null;
  quantity?: number | null;
  code?: string | null;
}

export interface ExportableList {
  title: string;
  items: readonly ExportableListItem[];
  subtitle?: string | null;
  createdAt?: Date | string | null;
  storeName?: string;
}

export interface GeneratedExport {
  blob: Blob;
  fileName: string;
  mimeType: string;
}
