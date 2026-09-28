export const TipoMovimentacao = {
  ENTRADA_REPARTE: "ENTRADA_REPARTE",
  RESERVA: "RESERVA",
  CANCELAMENTO: "CANCELAMENTO",
  RETIRADA: "RETIRADA",
  DEVOLUCAO: "DEVOLUCAO",
  AJUSTE_POSITIVO: "AJUSTE_POSITIVO",
  AJUSTE_NEGATIVO: "AJUSTE_NEGATIVO",
  PERDA: "PERDA",
} as const;

export type TipoMovimentacao =
  (typeof TipoMovimentacao)[keyof typeof TipoMovimentacao];