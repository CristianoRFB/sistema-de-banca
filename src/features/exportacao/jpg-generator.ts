import type { ExportableList } from "./exportacao.types";

const CANVAS_WIDTH = 1440;
const MAX_CANVAS_HEIGHT = 30000;
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function generateJpg(list: ExportableList): Promise<Blob> {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Não foi possível preparar a imagem da lista.");
  measure.font = "600 30px system-ui, sans-serif";
  const rows = list.items.map((item) => {
    const title = [item.title, item.volume ? "Vol. " + item.volume : ""]
      .filter(Boolean)
      .join(" ");
    const titleLines = wrapText(measure, title, 735);
    return {
      titleLines,
      height: Math.max(76, titleLines.length * 39 + 26),
      volume: item.volume ?? "—",
      price: item.price === null || item.price === undefined ? "—" : currency.format(item.price),
      quantity: item.quantity === null || item.quantity === undefined ? "—" : String(item.quantity),
    };
  });
  const headerHeight = 78;
  const titleHeight = list.subtitle ? 250 : 210;
  const totalHeight =
    titleHeight + headerHeight + rows.reduce((sum, row) => sum + row.height, 0) + 64;
  if (totalHeight > MAX_CANVAS_HEIGHT) {
    throw new Error("A lista é grande demais para uma única imagem. Reduza ou divida os itens.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = Math.max(560, totalHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível desenhar a imagem da lista.");

  context.fillStyle = "#f4f7f3";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#173b2b";
  context.fillRect(0, 0, canvas.width, titleHeight);
  context.fillStyle = "#ffffff";
  context.font = "700 48px system-ui, sans-serif";
  context.fillText(list.storeName ?? "Banca Ana Maria", 64, 76);
  context.font = "700 42px system-ui, sans-serif";
  context.fillText(list.title, 64, 139, CANVAS_WIDTH - 128);
  if (list.subtitle) {
    context.font = "400 26px system-ui, sans-serif";
    context.fillText(list.subtitle, 64, 183, CANVAS_WIDTH - 128);
  }

  const columns = { title: 64, volume: 890, price: 1050, quantity: 1260 };
  let y = titleHeight;
  context.fillStyle = "#dce8df";
  context.fillRect(0, y, CANVAS_WIDTH, headerHeight);
  context.fillStyle = "#173b2b";
  context.font = "700 25px system-ui, sans-serif";
  context.fillText("TÍTULO", columns.title, y + 49);
  context.fillText("VOLUME", columns.volume, y + 49);
  context.fillText("PREÇO", columns.price, y + 49);
  context.fillText("QTD.", columns.quantity, y + 49);
  y += headerHeight;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    context.fillStyle = index % 2 === 0 ? "#ffffff" : "#edf2ee";
    context.fillRect(0, y, CANVAS_WIDTH, row.height);
    context.fillStyle = "#20352a";
    context.font = "600 30px system-ui, sans-serif";
    row.titleLines.forEach((line, lineIndex) => {
      context.fillText(line, columns.title, y + 43 + lineIndex * 38, 770);
    });
    context.font = "500 27px system-ui, sans-serif";
    context.fillText(row.volume, columns.volume, y + 45, 135);
    context.fillText(row.price, columns.price, y + 45, 190);
    context.fillText(row.quantity, columns.quantity, y + 45, 110);
    context.strokeStyle = "#d8e1da";
    context.beginPath();
    context.moveTo(48, y + row.height);
    context.lineTo(CANVAS_WIDTH - 48, y + row.height);
    context.stroke();
    y += row.height;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("O navegador não conseguiu gerar o JPG."));
      },
      "image/jpeg",
      0.92,
    );
  });
}
