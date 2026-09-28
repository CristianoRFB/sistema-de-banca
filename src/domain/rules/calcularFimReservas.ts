import { DomainRuleError } from "../validation";

/** Calcula a data de bloqueio com a margem de segurança anterior ao recolhimento. */
export function calcularFimReservas(
  dataRecolhimento: Date | null,
  margemSegurancaDias = 2,
): Date | null {
  if (dataRecolhimento === null) return null;
  if (!Number.isFinite(dataRecolhimento.getTime())) {
    throw new DomainRuleError(
      "DATA_INVALIDA",
      "A data de recolhimento é inválida.",
    );
  }
  if (!Number.isSafeInteger(margemSegurancaDias) || margemSegurancaDias < 0) {
    throw new DomainRuleError(
      "MARGEM_INVALIDA",
      "A margem deve ser um número inteiro de dias não negativo.",
    );
  }

  const fim = new Date(dataRecolhimento.getTime());
  fim.setDate(fim.getDate() - margemSegurancaDias);
  return fim;
}
