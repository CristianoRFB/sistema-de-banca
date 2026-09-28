import { useState } from "react";
import type { ExportableList } from "../../exportacao/exportacao.types";
import { downloadExport, safeFileName } from "../../exportacao/download";
import { generateJpg } from "../../exportacao/jpg-generator";
import { generatePdf } from "../../exportacao/pdf-generator";
import { generateXlsx } from "../../exportacao/xlsx-generator";
import { shareList } from "../../exportacao/whatsapp-share";

export interface ExportarListaProps {
  list: ExportableList;
}

type ExportFormat = "JPG" | "PDF" | "XLSX";

export function ExportarLista({ list }: ExportarListaProps) {
  const [working, setWorking] = useState<ExportFormat | "share" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);

  const download = async (format: ExportFormat) => {
    setWorking(format);
    setStatus(null);
    setWhatsappUrl(null);
    try {
      const blob =
        format === "JPG"
          ? await generateJpg(list)
          : format === "PDF"
            ? await generatePdf(list)
            : await generateXlsx(list);
      downloadExport(blob, safeFileName(list.title) + "." + format.toLowerCase());
      setStatus(format + " gerado neste dispositivo.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Não foi possível gerar o arquivo.");
    } finally {
      setWorking(null);
    }
  };

  const share = async () => {
    setWorking("share");
    setStatus(null);
    setWhatsappUrl(null);
    try {
      const jpg = await generateJpg(list);
      const result = await shareList(list, [
        { blob: jpg, fileName: safeFileName(list.title) + ".jpg" },
      ]);
      if (result.status === "shared") {
        setStatus("A lista foi aberta no menu de compartilhamento do dispositivo.");
      } else if (result.status === "cancelled") {
        setStatus("Compartilhamento cancelado.");
      } else {
        setStatus("A imagem foi baixada. Abra o WhatsApp e anexe o arquivo antes de escolher o destinatário.");
        setWhatsappUrl(result.whatsappUrl);
      }
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Não foi possível compartilhar a lista.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <section aria-labelledby="exportar-lista-titulo">
      <h2 id="exportar-lista-titulo">Exportar e divulgar</h2>
      <p>Os arquivos são montados no dispositivo e não ficam armazenados no sistema.</p>
      <div>
        <button type="button" disabled={working !== null} onClick={() => void download("JPG")}>
          {working === "JPG" ? "Gerando JPG…" : "Baixar JPG"}
        </button>
        <button type="button" disabled={working !== null} onClick={() => void download("PDF")}>
          {working === "PDF" ? "Gerando PDF…" : "Baixar PDF"}
        </button>
        <button type="button" disabled={working !== null} onClick={() => void download("XLSX")}>
          {working === "XLSX" ? "Gerando planilha…" : "Baixar XLSX"}
        </button>
        <button type="button" disabled={working !== null} onClick={() => void share()}>
          {working === "share" ? "Preparando compartilhamento…" : "Compartilhar"}
        </button>
      </div>
      {status && <p role="status">{status}</p>}
      {whatsappUrl && (
        <p>
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            Continuar para o WhatsApp
          </a>
        </p>
      )}
    </section>
  );
}
