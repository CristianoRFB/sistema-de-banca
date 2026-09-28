import type { ExportableList } from "./exportacao.types";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export async function generatePdf(list: ExportableList): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const titleWidth = contentWidth - 72;
  let y = 18;

  const drawHeader = () => {
    document.setFillColor(23, 59, 43);
    document.rect(0, 0, pageWidth, 39, "F");
    document.setTextColor(255, 255, 255);
    document.setFont("helvetica", "bold");
    document.setFontSize(11);
    document.text(list.storeName ?? "Banca Ana Maria", margin, 14);
    document.setFontSize(14);
    const heading = document.splitTextToSize(list.title, contentWidth);
    document.text(heading.slice(0, 2), margin, 25);
    document.setTextColor(31, 41, 34);
    y = 48;
  };

  const drawTableHead = () => {
    document.setFillColor(220, 232, 223);
    document.rect(margin, y, contentWidth, 10, "F");
    document.setFont("helvetica", "bold");
    document.setFontSize(8);
    document.text("TÍTULO", margin + 2, y + 6.5);
    document.text("VOL.", margin + titleWidth + 2, y + 6.5);
    document.text("PREÇO", margin + titleWidth + 17, y + 6.5);
    document.text("QTD.", pageWidth - margin - 15, y + 6.5);
    y += 10;
  };

  drawHeader();
  if (list.subtitle) {
    document.setFont("helvetica", "normal");
    document.setFontSize(9);
    const subtitle = document.splitTextToSize(list.subtitle, contentWidth);
    document.text(subtitle, margin, y);
    y += subtitle.length * 4 + 4;
  }
  drawTableHead();

  list.items.forEach((item, index) => {
    const title = item.title + (item.volume ? " — Vol. " + item.volume : "");
    document.setFont("helvetica", "normal");
    document.setFontSize(9);
    const lines = document.splitTextToSize(title, titleWidth - 4);
    const rowHeight = Math.max(9, lines.length * 4.5 + 3);
    if (y + rowHeight > pageHeight - 18) {
      document.addPage();
      drawHeader();
      drawTableHead();
    }
    if (index % 2 === 0) {
      document.setFillColor(248, 250, 248);
      document.rect(margin, y, contentWidth, rowHeight, "F");
    }
    document.setTextColor(31, 41, 34);
    document.text(lines, margin + 2, y + 5.5);
    if (item.volume) document.text(item.volume, margin + titleWidth + 2, y + 5.5);
    if (item.price !== null && item.price !== undefined) {
      document.text(currency.format(item.price), margin + titleWidth + 17, y + 5.5);
    }
    if (item.quantity !== null && item.quantity !== undefined) {
      document.text(String(item.quantity), pageWidth - margin - 15, y + 5.5);
    }
    y += rowHeight;
  });

  const pages = document.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    document.setPage(page);
    document.setFontSize(8);
    document.setTextColor(100, 110, 102);
    document.text(
      page + " / " + pages,
      pageWidth - margin,
      pageHeight - 8,
      { align: "right" },
    );
  }
  document.setProperties({
    title: list.title,
    subject: "Lista de produtos",
    creator: list.storeName ?? "Banca Ana Maria",
  });
  return document.output("blob");
}
