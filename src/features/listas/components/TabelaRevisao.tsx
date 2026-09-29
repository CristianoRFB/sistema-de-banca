import type { ChangeEvent } from "react";
import { TipoProduto, type TipoProduto as TipoProdutoValue } from "../../../domain/enums/TipoProduto";
import type { ImportField, ImportedListRow } from "../../importacao/importacao.types";

export interface TabelaRevisaoProps {
  rows: readonly ImportedListRow[];
  onChange: (rows: ImportedListRow[]) => void;
  disabled?: boolean;
}

const productTypes: Array<{ value: TipoProdutoValue; label: string }> = [
  { value: TipoProduto.MANGA, label: "Mangá" },
  { value: TipoProduto.REVISTA, label: "Revista" },
  { value: TipoProduto.BOX, label: "Box" },
  { value: TipoProduto.COLECIONAVEL, label: "Colecionável" },
  { value: TipoProduto.OUTRO, label: "Outro" },
];

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
    if (field !== "title") return { ...row, [field]: value || null, requiresReview: true } as ImportedListRow;
    return { ...row, [field]: value, requiresReview: true } as ImportedListRow;
  });
  onChange(next);
}

export function TabelaRevisao({ rows, onChange, disabled = false }: TabelaRevisaoProps) {
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
      <div className="review-table-toolbar"><span>{rows.filter((row) => row.requiresReview).length} linhas aguardam conferência</span><button className="button button--secondary button--small" type="button" disabled={disabled} onClick={addRow}>+ Adicionar linha</button></div>
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
            <th scope="col">Código</th>
            <th scope="col">Editora</th>
            <th scope="col">Título original</th>
            <th scope="col">Recolhimento</th>
            <th scope="col">Tipo</th>
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
                  disabled={disabled}
                  value={row.title}
                  onChange={(event) => updateCell(rows, rowIndex, "title", event, onChange)}
                />
              </td>
              <td data-label="Volume">
                <input
                  aria-label={"Volume, linha " + row.line}
                  disabled={disabled}
                  value={row.volume ?? ""}
                  onChange={(event) => updateCell(rows, rowIndex, "volume", event, onChange)}
                />
              </td>
              <td data-label="Preço">
                <input
                  aria-label={"Preço, linha " + row.line}
                  disabled={disabled}
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
                  disabled={disabled}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={row.quantity ?? ""}
                  onChange={(event) => updateCell(rows, rowIndex, "quantity", event, onChange)}
                />
              </td>
              <td data-label="Código">
                <input aria-label={"Código, linha " + row.line} disabled={disabled} value={row.code ?? ""} onChange={(event) => updateCell(rows, rowIndex, "code", event, onChange)} />
              </td>
              <td data-label="Editora">
                <input aria-label={"Editora, linha " + row.line} disabled={disabled} value={row.publisher ?? ""} onChange={(event) => updateCell(rows, rowIndex, "publisher", event, onChange)} />
              </td>
              <td data-label="Título original">
                <input aria-label={"Título original, linha " + row.line} disabled={disabled} value={row.originalTitle ?? ""} onChange={(event) => updateCell(rows, rowIndex, "originalTitle", event, onChange)} />
              </td>
              <td data-label="Data de recolhimento">
                <input aria-label={"Data de recolhimento, linha " + row.line} disabled={disabled} type="date" value={row.returnDate ?? ""} onChange={(event) => updateCell(rows, rowIndex, "returnDate", event, onChange)} />
              </td>
              <td data-label="Tipo de produto">
                <select aria-label={"Tipo de produto, linha " + row.line} disabled={disabled} value={row.type ?? TipoProduto.MANGA} onChange={(event) => {
                  const value = event.currentTarget.value as TipoProdutoValue;
                  onChange(rows.map((item, index) => index === rowIndex ? { ...item, type: value, requiresReview: true } : item));
                }}>
                  {productTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </td>
              <td data-label="Confiança">
                <span aria-label={"Confiança: " + Math.round(row.confidence * 100) + "%"}>
                  {Math.round(row.confidence * 100)}%
                </span>
                {row.requiresReview && <span className="review-row-flag">Revisar</span>}
                {row.issues.length > 0 && <ul>{row.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
              </td>
              <td data-label="Conferência"><label className="review-check"><input type="checkbox" disabled={disabled} checked={!row.requiresReview} onChange={(event) => setReviewed(row.id, event.target.checked)} /><span>Conferida</span></label></td>
              <td data-label="Ações"><button className="table-remove" type="button" disabled={disabled} aria-label={`Remover linha ${row.line}`} onClick={() => removeRow(row.id)}>Remover</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
