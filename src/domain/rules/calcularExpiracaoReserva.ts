import { DomainRuleError } from "../validation";

export const DURACAO_MAXIMA_RESERVA_MS = 9 * 24 * 60 * 60 * 1000;

export interface OpcoesExpiracaoReserva {
  /** Prazo explícito de retenção, usado como fallback sem data de retirada. */
  duracaoMs?: number;
  /** Data desejada pelo cliente, à qual se soma a tolerância configurada. */
  dataRetiradaPretendida?: Date;
  toleranciaRetiradaDias?: number;
  /** Limite mais curto definido pelo fim de reservas do lote. */
  limiteEm?: Date | null;
}

/**
 * Expiração e retirada são campos distintos: a tolerância estende o prazo após
 * a data desejada, enquanto o fim de reservas do lote pode antecipá-lo.
 */
export function calcularExpiracaoReserva(
  criadaEm: Date,
  opcoes: OpcoesExpiracaoReserva = {},
): Date {
  if (!Number.isFinite(criadaEm.getTime())) {
    throw new DomainRuleError("DATA_INVALIDA", "A data de criação é inválida.");
  }

  let expiraEm: Date;
  if (opcoes.dataRetiradaPretendida) {
    if (!Number.isFinite(opcoes.dataRetiradaPretendida.getTime())) {
      throw new DomainRuleError(
        "DATA_INVALIDA",
        "A data pretendida de retirada é inválida.",
      );
    }
    const toleranciaDias = opcoes.toleranciaRetiradaDias ?? 0;
    if (!Number.isSafeInteger(toleranciaDias) || toleranciaDias < 0) {
      throw new DomainRuleError(
        "TOLERANCIA_INVALIDA",
        "A tolerância deve ser um número inteiro de dias não negativo.",
      );
    }
    expiraEm = new Date(opcoes.dataRetiradaPretendida.getTime());
    expiraEm.setDate(expiraEm.getDate() + toleranciaDias);
  } else {
    const duracaoMs = opcoes.duracaoMs ?? DURACAO_MAXIMA_RESERVA_MS;
    if (!Number.isFinite(duracaoMs) || duracaoMs <= 0) {
      throw new DomainRuleError(
        "PRAZO_INVALIDO",
        "A duração da reserva deve ser positiva.",
      );
    }
    expiraEm = new Date(
      criadaEm.getTime() + Math.min(duracaoMs, DURACAO_MAXIMA_RESERVA_MS),
    );
  }

  if (opcoes.limiteEm == null) {
    if (expiraEm.getTime() <= criadaEm.getTime()) {
      throw new DomainRuleError(
        "EXPIRACAO_INVALIDA",
        "A expiração deve ocorrer depois da criação da reserva.",
      );
    }
    return expiraEm;
  }
  if (!Number.isFinite(opcoes.limiteEm.getTime())) {
    throw new DomainRuleError("DATA_INVALIDA", "O limite da reserva é inválido.");
  }
  if (opcoes.limiteEm.getTime() <= criadaEm.getTime()) {
    throw new DomainRuleError(
      "LIMITE_EXPIRADO",
      "O limite do lote não deixa prazo para criar esta reserva.",
    );
  }
  if (opcoes.limiteEm.getTime() <= expiraEm.getTime()) {
    expiraEm = new Date(opcoes.limiteEm.getTime());
  }
  if (expiraEm.getTime() <= criadaEm.getTime()) {
    throw new DomainRuleError(
      "EXPIRACAO_INVALIDA",
      "A expiração deve ocorrer depois da criação da reserva.",
    );
  }
  return expiraEm;
}
