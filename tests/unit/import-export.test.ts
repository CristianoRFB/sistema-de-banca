import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createImportDraftFromRows,
  parseCsvFile,
} from "../../src/features/importacao/excel/excel-parser";
import { createManualImportDraft, parseTextImport } from "../../src/features/importacao/text-parser";
import type { ExportableList } from "../../src/features/exportacao/exportacao.types";
import { generatePdf } from "../../src/features/exportacao/pdf-generator";
import { generateXlsx } from "../../src/features/exportacao/xlsx-generator";
import { generateShareMessage } from "../../src/features/exportacao/message-generator";
import { shareList } from "../../src/features/exportacao/whatsapp-share";

const exportList: ExportableList = {
  title: "Chegou na banca",
  storeName: "Banca Ana Maria",
  items: [
    { title: "Wistoria", volume: "09", price: 12.5, quantity: 2 },
    { title: "Wind Breaker", volume: "25", price: null, quantity: null },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("importação local e revisão", () => {
  it("cria rascunho manual, preserva zeros do volume e exige conferência", () => {
    const draft = createManualImportDraft([
      "Agentes das Estações 01",
      "Wistoria 09",
    ]);

    expect(draft).toMatchObject({
      source: "MANUAL",
      status: "RASCUNHO",
      requiresHumanReview: true,
    });
    expect(draft.rows.map(({ title, volume }) => [title, volume])).toEqual([
      ["Agentes das Estações", "01"],
      ["Wistoria", "09"],
    ]);
    expect(draft.rows.every((row) => row.requiresReview)).toBe(true);
  });

  it("interpreta CSV com separador brasileiro, aspas e preço em reais", async () => {
    const file = Object.assign(
      new Blob(
        [
          'Título;Volume;Preço;Quantidade;Editora\r\n"On/Off";"03";"R$ 12,50";2;NewPop',
        ],
        { type: "text/csv" },
      ),
      { name: "lista.csv" },
    );

    const draft = await parseCsvFile(file);
    expect(draft.source).toBe("CSV");
    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]).toMatchObject({
      title: "On/Off",
      volume: "03",
      price: 12.5,
      quantity: 2,
      publisher: "NewPop",
      requiresReview: true,
    });
  });

  it("interpreta texto livre sem quebrar títulos com vírgula em outra linha", () => {
    const draft = parseTextImport(
      "On/Off, edição especial 03\nWind Breaker 25\nColégio Ouran 01",
    );

    expect(draft.rows.map((row) => row.title)).toEqual([
      "On/Off, edição especial",
      "Wind Breaker",
      "Colégio Ouran",
    ]);
    expect(draft.rows.map((row) => row.volume)).toEqual(["03", "25", "01"]);
    expect(draft.requiresHumanReview).toBe(true);
  });

  it("marca linhas de baixa confiança para revisão explícita", () => {
    const draft = createImportDraftFromRows(
      [["Wistoria 09"]],
      "FOTO",
      null,
      {},
      0.3,
    );

    expect(draft.status).toBe("RASCUNHO");
    expect(draft.requiresHumanReview).toBe(true);
    expect(draft.rows[0].requiresReview).toBe(true);
    expect(draft.rows[0].confidence).toBeLessThan(0.72);
    expect(draft.rows[0].issues).toContain("Baixa confiança: revise esta linha");
    expect(draft.warnings).toContain("Há linhas com dados ausentes ou de baixa confiança para revisar.");
  });
});

describe("exportação local e compartilhamento", () => {
  it("gera XLSX e mantém volumes com zero à esquerda como texto", async () => {
    const blob = await generateXlsx(exportList);
    const exceljs = await import("exceljs");
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());

    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(workbook.getWorksheet("Lista")?.getCell("B2").text).toBe("09");
    expect(workbook.getWorksheet("Lista")?.getCell("C2").value).toBe(12.5);
  });

  it("gera PDF local não vazio", async () => {
    const blob = await generatePdf(exportList);

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("prepara mensagem de divulgação sem prometer envio automático", () => {
    const message = generateShareMessage(exportList);
    const expectedPrice = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(12.5);

    expect(message).toContain("Wistoria 09 — " + expectedPrice);
    expect(message).toContain("chame no privado");
    expect(message).not.toMatch(/enviado automaticamente/i);
  });

  it("usa fallback de download e retorna link do WhatsApp quando arquivos não podem ser compartilhados", async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:lista"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.stubGlobal("navigator", {
      canShare: vi.fn(() => false),
      share: vi.fn(),
    });

    const result = await shareList(exportList, [
      { blob: new Blob(["local image"], { type: "image/jpeg" }), fileName: "lista.jpg" },
    ]);

    expect(result.status).toBe("downloaded");
    if (result.status !== "downloaded") throw new Error("Fallback esperado");
    expect(result.fileNames).toEqual(["lista.jpg"]);
    expect(result.whatsappUrl).toContain("https://wa.me/?text=");
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(navigator.share).not.toHaveBeenCalled();
  });
});
