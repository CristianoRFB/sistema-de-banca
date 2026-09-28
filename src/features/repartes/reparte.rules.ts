import type { ItemReparte } from "../../domain/entities/ItemReparte";
import { ItemReparteStatus } from "../../domain/enums/ItemReparteStatus";
import { calcularDisponibilidade } from "../../domain/rules/calcularDisponibilidade";
import { failure, issue, success } from "../../domain/validation";
import type { ValidationIssue, ValidationResult } from "../../domain/validation";

const statusSemReserva = new Set<ItemReparte["status"]>([
  ItemReparteStatus.BLOQUEADO_PARA_RECOLHIMENTO,
  ItemReparteStatus.AGUARDANDO_RECOLHIMENTO,
  ItemReparteStatus.DEVOLVIDO,
  ItemReparteStatus.ARQUIVADO,
]);

export interface ChecagemReservaReparte {
  disponivel: number;
  podeReservar: boolean;
  motivo: string | null;
}

export function verificarDisponibilidadeReparte(
  item: ItemReparte,
  agora: Date,
): ValidationResult<ChecagemReservaReparte> {
  let disponivel: number;
  try {
    disponivel = calcularDisponibilidade(item);
  } catch (error) {
    return failure(
      issue(
        "SALDO_INVALIDO",
        "itemReparte",
        error instanceof Error ? error.message : "O saldo do lote é inválido.",
      ),
    );
  }

  if (!Number.isFinite(agora.getTime())) {
    return failure(issue("DATA_INVALIDA", "agora", "Informe uma data válida."));
  }
  const fimReservas = item.dataFimReservas;
  if (fimReservas && agora.getTime() >= fimReservas.getTime()) {
    return success({
      disponivel,
      podeReservar: false,
      motivo: "O prazo de novas reservas deste lote terminou.",
    });
  }
  if (statusSemReserva.has(item.status)) {
    return success({
      disponivel,
      podeReservar: false,
      motivo: "Este item não aceita novas reservas.",
    });
  }
  if (disponivel === 0) {
    return success({
      disponivel,
      podeReservar: false,
      motivo: "Não há unidades disponíveis.",
    });
  }

  return success({ disponivel, podeReservar: true, motivo: null });
}

export function derivarStatusItemReparte(
  item: ItemReparte,
  agora: Date,
): ItemReparte["status"] {
  if (statusSemReserva.has(item.status)) return item.status;

  const limiteRecolhimento = item.dataRecolhimentoOverride;
  if (limiteRecolhimento && agora.getTime() >= limiteRecolhimento.getTime()) {
    return ItemReparteStatus.AGUARDANDO_RECOLHIMENTO;
  }
  if (item.dataFimReservas && agora.getTime() >= item.dataFimReservas.getTime()) {
    return ItemReparteStatus.BLOQUEADO_PARA_RECOLHIMENTO;
  }

  const disponivel = calcularDisponibilidade(item);
  if (disponivel === 0) return ItemReparteStatus.ESGOTADO;
  if (item.quantidadeReservada > 0) return ItemReparteStatus.RESERVADO;
  return ItemReparteStatus.DISPONIVEL;
}

/** Impede correções de quantidade que tornariam o saldo armazenado impossível. */
export function validarQuantidadeRecebida(
  item: Pick<
    ItemReparte,
    | "quantidadeReservada"
    | "quantidadeRetirada"
    | "quantidadeDevolvida"
  >,
  novaQuantidadeRecebida: number,
): ValidationResult<number> {
  if (!Number.isSafeInteger(novaQuantidadeRecebida) || novaQuantidadeRecebida < 0) {
    return failure(
      issue("QUANTIDADE_INVALIDA", "quantidadeRecebida", "Informe um inteiro não negativo."),
    );
  }
  const quantidades = [
    item.quantidadeReservada,
    item.quantidadeRetirada,
    item.quantidadeDevolvida,
  ];
  if (quantidades.some((quantidade) => !Number.isSafeInteger(quantidade) || quantidade < 0)) {
    return failure(
      issue("SALDO_INVALIDO", "itemReparte", "Os totais existentes devem ser inteiros não negativos."),
    );
  }
  const comprometido =
    item.quantidadeReservada +
    item.quantidadeRetirada +
    item.quantidadeDevolvida;
  if (!Number.isSafeInteger(comprometido)) {
    return failure(
      issue("SALDO_INVALIDO", "itemReparte", "A soma dos totais existentes excede o limite seguro de cálculo."),
    );
  }
  if (novaQuantidadeRecebida < comprometido) {
    return failure(
      issue(
        "ABAIXO_DO_COMPROMETIDO",
        "quantidadeRecebida",
        "A quantidade não pode ficar abaixo das unidades reservadas, retiradas ou devolvidas.",
      ),
    );
  }
  return success(novaQuantidadeRecebida);
}

export function validarMargemSeguranca(
  margemSegurancaDias: number,
): ValidationResult<number> {
  if (!Number.isSafeInteger(margemSegurancaDias) || margemSegurancaDias < 0) {
    return failure(
      issue("MARGEM_INVALIDA", "margemSegurancaDias", "A margem deve ser um inteiro não negativo."),
    );
  }
  return success(margemSegurancaDias);
}

export function coletarIssuesReparte(
  resultados: readonly ValidationResult<unknown>[],
): ValidationIssue[] {
  return resultados.flatMap((resultado) => (resultado.ok ? [] : resultado.issues));
}
