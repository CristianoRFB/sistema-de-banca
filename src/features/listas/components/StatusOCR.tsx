import type { ImportProgress } from "../../importacao/importacao.types";

export interface StatusOCRProps {
  progress: Parameters<ImportProgress>[0];
  working?: boolean;
}

export function StatusOCR({ progress, working = true }: StatusOCRProps) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {working ? (
        <>
          <progress
            aria-label={progress.message ?? "Progresso da importação"}
            max={100}
            value={progress.percent}
          />
          <span>
            {progress.message ?? "Processando"} ({progress.percent}%)
          </span>
        </>
      ) : (
        <span>{progress.message ?? "Importação concluída."}</span>
      )}
    </div>
  );
}
