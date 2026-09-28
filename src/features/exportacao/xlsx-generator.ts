import type { ExportableList } from "./exportacao.types";
import { safeFileName } from "./download";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function generateXlsx(list: ExportableList): Promise<Blob> {
  const exceljs = await import("exceljs");
  const workbook = new exceljs.Workbook();
  workbook.creator = list.storeName ?? "Banca Ana Maria";
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheet = workbook.addWorksheet("Lista", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Título", key: "title", width: 48 },
    { header: "Volume", key: "volume", width: 14 },
    { header: "Preço", key: "price", width: 16 },
    { header: "Quantidade", key: "quantity", width: 16 },
    { header: "Código", key: "code", width: 22 },
  ];
  for (const item of list.items) {
    sheet.addRow({
      title: item.title,
      // Keep volume as text, including leading zeroes such as 01 and 09.
      volume: item.volume ?? "",
      price: item.price ?? null,
      quantity: item.quantity ?? null,
      code: item.code ?? "",
    });
  }

  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF22543D" },
  };
  header.alignment = { vertical: "middle" };
  sheet.getColumn(2).numFmt = "@";
  sheet.getColumn(3).numFmt = '"R$" #,##0.00';
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, list.items.length + 1), column: 5 },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: XLSX_MIME });
}

export async function generateXlsxFile(list: ExportableList): Promise<File> {
  const blob = await generateXlsx(list);
  return new File([blob], safeFileName(list.title) + ".xlsx", { type: XLSX_MIME });
}
