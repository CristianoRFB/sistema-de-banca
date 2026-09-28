import type { ItemReparte } from "../entities/ItemReparte";
import { DomainRuleError } from "../validation";

export type TotaisEstoque = Pick<
  ItemReparte,
  | "quantidadeRecebida"
  | "quantidadeReservada"
  | "quantidadeRetirada"
  | "quantidadeDevolvida"
>;

export type TotaisFisicos = Pick<
  ItemReparte,
  "quantidadeRecebida" | "quantidadeRetirada" | "quantidadeDevolvida"
>;

function validarQuantidade(nome: string, quantidade: number): void {
  if (!Number.isSafeInteger(quantidade) || quantidade < 0) {
    throw new DomainRuleError(
      "QUANTIDADE_INVALIDA",
      nome + " deve ser um inteiro não negativo.",
    );
  }
}

/** Estoque livre para novas reservas, calculado sempre a partir dos totais. */
export function calcularDisponibilidade(totais: TotaisEstoque): number {
  validarQuantidade("quantidadeRecebida", totais.quantidadeRecebida);
  validarQuantidade("quantidadeReservada", totais.quantidadeReservada);
  validarQuantidade("quantidadeRetirada", totais.quantidadeRetirada);
  validarQuantidade("quantidadeDevolvida", totais.quantidadeDevolvida);

  const comprometido =
    totais.quantidadeReservada +
    totais.quantidadeRetirada +
    totais.quantidadeDevolvida;

  if (!Number.isSafeInteger(comprometido)) {
    throw new DomainRuleError(
      "QUANTIDADE_FORA_DO_LIMITE",
      "A soma dos totais do lote excede o limite seguro de cálculo.",
    );
  }

  if (comprometido > totais.quantidadeRecebida) {
    throw new DomainRuleError(
      "SALDO_NEGATIVO",
      "Reservas, retiradas e devoluções não podem exceder a quantidade recebida.",
    );
  }

  return totais.quantidadeRecebida - comprometido;
}

/** Quantidade que deve estar fisicamente na banca; reservas continuam no local. */
export function calcularQuantidadeFisicaEsperada(
  totais: TotaisFisicos,
): number {
  validarQuantidade("quantidadeRecebida", totais.quantidadeRecebida);
  validarQuantidade("quantidadeRetirada", totais.quantidadeRetirada);
  validarQuantidade("quantidadeDevolvida", totais.quantidadeDevolvida);

  const saida = totais.quantidadeRetirada + totais.quantidadeDevolvida;
  if (!Number.isSafeInteger(saida)) {
    throw new DomainRuleError(
      "QUANTIDADE_FORA_DO_LIMITE",
      "A soma de retiradas e devoluções excede o limite seguro de cálculo.",
    );
  }
  const esperado = totais.quantidadeRecebida - saida;

  if (esperado < 0) {
    throw new DomainRuleError(
      "SALDO_FISICO_NEGATIVO",
      "Retiradas e devoluções não podem exceder a quantidade recebida.",
    );
  }

  return esperado;
}
