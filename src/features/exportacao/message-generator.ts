import type { ExportableList } from "./exportacao.types";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function generateShareMessage(list: ExportableList): string {
  const items = list.items.map((item) => {
    const name = item.title + (item.volume ? " " + item.volume : "");
    const details = item.price === null || item.price === undefined
      ? ""
      : " — " + currency.format(item.price);
    return "• " + name + details;
  });
  const lines = [
    "📚 " + (list.title || "Novidades") + " — " + (list.storeName ?? "Banca Ana Maria"),
    "",
    ...items,
    "",
    "Para consultar disponibilidade ou reservar, chame no privado.",
  ];
  return lines.join("\n");
}
