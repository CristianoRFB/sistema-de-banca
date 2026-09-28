import type { ChangeEvent } from "react";
import type { ImportField, ImportedListRow } from "../../importacao/importacao.types";

export interface TabelaRevisaoProps {
  rows: readonly ImportedListRow[];
  onChange: (rows: ImportedListRow[]) => void;
}

function updateCell(
  rows: readonly ImportedListRow[],
  rowIndex: number,
  field: ImportField,
  event: ChangeEvent<HTMLInputElement>,
  onChange: TabelaRevisaoProps["onChange"],
): void {
  const value = event.currentTarget.value;
  const next = rows.map((row, index) => {
    if (index !== rowIndex) return row;
    if (field === "price") return { ...row, price: value === "" ? null : Number(value), requiresReview: true };
    if (field === "quantity") return { ...row, quantity: value === "" ? null : Number(value), requiresReview: true };
    if (field === "volume") return { ...row, volume: value || null, requiresReview: true };
    return { ...row, [field]: value, requiresReview: true } as ImportedListRow;
  });
  onChange(next);
}

export function TabelaRevisao({ rows, onChange }: TabelaRevisaoProps) {
  function addRow() {
    const line = rows.reduce((maximum, row) => Math.max(maximum, row.line), 0) + 1;
    onChange([...rows, {
      id: crypto.randomUUID(), line, title: "", volume: null, price: null, quantity: null, type: "MANGA",
      code: null, publisher: null, originalTitle: null, returnDate: null, confidence: 1,
      fieldConfidence: {}, issues: ["Linha adicionada manualmente"], requiresReview: true,
    }]);
  }

  function removeRow(rowId: string) {
    onChange(rows.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, line: index + 1 })));
  }

  function setReviewed(rowId: string, reviewed: boolean) {
    onChange(rows.map((row) => row.id === rowId ? { ...row, requiresReview: !reviewed } : row));
  }

  return (
    <div className="review-table-wrap">
      <div className="review-table-toolbar"><span>{rows.filter((row) => row.requiresReview).length} linhas aguardam conferência</span><button className="button button--secondary button--small" type="button" onClick={addRow}>+ Adicionar linha</button></div>
      <div className="review-table-scroll">
      <table>
        <caption>Revise os dados extraídos antes de salvar o rascunho</caption>
        <thead>
          <tr>
            <th scope="col">Linha</th>
            <th scope="col">Título</th>
            <th scope="col">Volume</th>
            <th scope="col">Preço</th>
            <th scope="col">Quantidade</th>
            <th scope="col">Confiança</th>
            <th scope="col">Conferência</th>
            <th scope="col"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id}>
              <td data-label="Linha">{row.line}</td>
              <td data-label="Título">
                <input
                  aria-label={"Título, linha " + row.line}
                  value={row.title}
                  onChange={(event) => updateCell(rows, rowIndex, "title", event, onChange)}
                />
              </td>
              <td data-label="Volume">
                <input
                  aria-label={"Volume, linha " + row.line}
                  value={row.volume ?? ""}
                  onChange={(event) => updateCell(rows, rowIndex, "volume", event, onChange)}
                />
              </td>
              <td data-label="Preço">
                <input
                  aria-label={"Preço, linha " + row.line}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={row.price ?? ""}
                  onChange={(event) => updateCell(rows, rowIndex, "price", event, onChange)}
                />
              </td>
              <td data-label="Quantidade">
                <input
                  aria-label={"Quantidade, linha " + row.line}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={row.quantity ?? ""}
                  onChange={(event) => updateCell(rows, rowIndex, "quantity", event, onChange)}
                />
              </td>
              <td data-label="Confiança">
                <span aria-label={"Confiança: " + Math.round(row.confidence * 100) + "%"}>
                  {Math.round(row.confidence * 100)}%
                </span>
                {row.requiresReview && <span className="review-row-flag">Revisar</span>}
                {row.issues.length > 0 && <ul>{row.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
              </td>
              <td data-label="Conferência"><label className="review-check"><input type="checkbox" checked={!row.requiresReview} onChange={(event) => setReviewed(row.id, event.target.checked)} /><span>Conferida</span></label></td>
              <td data-label="Ações"><button className="table-remove" type="button" aria-label={`Remover linha ${row.line}`} onClick={() => removeRow(row.id)}>Remover</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
