import { useState, type ChangeEvent } from "react";
import { parseImportFile } from "../../importacao/import-service";
import type { ImportDraft, ImportProgress } from "../../importacao/importacao.types";
import { createManualImportDraft } from "../../importacao/text-parser";
import { StatusOCR } from "./StatusOCR";

export interface ImportarArquivoProps {
  onDraftReady: (draft: ImportDraft) => void;
  onError?: (message: string) => void;
}

export function ImportarArquivo({ onDraftReady, onError }: ImportarArquivoProps) {
  const [manualText, setManualText] = useState("");
  const [progress, setProgress] = useState<Parameters<ImportProgress>[0] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reportError = (message: string) => {
    setError(message);
    onError?.(message);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setWorking(true);
    setError(null);
    setProgress({ stage: "read", percent: 0, message: "Iniciando importação" });
    try {
      const draft = await parseImportFile(file, { onProgress: setProgress });
      onDraftReady(draft);
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : "Não foi possível importar este arquivo.");
    } finally {
      setWorking(false);
    }
  };

  const handleManual = () => {
    const lines = manualText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      reportError("Digite ao menos um título para criar o rascunho.");
      return;
    }
    setError(null);
    onDraftReady(createManualImportDraft(lines));
    setManualText("");
  };

  return (
    <section aria-labelledby="importar-arquivo-titulo">
      <h2 id="importar-arquivo-titulo">Importar produtos</h2>
      <p>Escolha uma foto, PDF, planilha ou texto. O arquivo será processado neste dispositivo.</p>
      <label htmlFor="arquivo-lista">Selecionar arquivo</label>
      <input
        id="arquivo-lista"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.pdf,.xlsx,.csv,.txt,.tsv,image/*,application/pdf"
        disabled={working}
        onChange={handleFile}
      />

      <div>
        <label htmlFor="texto-manual">Ou cole uma linha por produto</label>
        <textarea
          id="texto-manual"
          rows={6}
          value={manualText}
          onChange={(event) => setManualText(event.currentTarget.value)}
          placeholder={"Agentes das Estações 01\nWistoria 09\nWind Breaker 25"}
          disabled={working}
          style={{ display: "block", width: "100%", marginBlock: 8 }}
        />
        <button type="button" onClick={handleManual} disabled={working}>
          Criar rascunho manual
        </button>
      </div>

      {progress && <StatusOCR progress={progress} working={working} />}
      {error && <p role="alert">{error}</p>}
      <p role="note">Toda importação cria um rascunho. Confira os títulos e volumes antes de salvar.</p>
    </section>
  );
}
