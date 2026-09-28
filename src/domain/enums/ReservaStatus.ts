export const ReservaStatus = {
  ATIVA: "ATIVA",
  PARCIALMENTE_RETIRADA: "PARCIALMENTE_RETIRADA",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
  EXPIRADA: "EXPIRADA",
} as const;

export type ReservaStatus = (typeof ReservaStatus)[keyof typeof ReservaStatus];