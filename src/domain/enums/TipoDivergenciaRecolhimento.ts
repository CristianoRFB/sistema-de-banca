export const TipoDivergenciaRecolhimento = {
  SOBRA: "SOBRA",
  FALTA: "FALTA",
  LOTE_DIFERENTE: "LOTE_DIFERENTE",
  NAO_CADASTRADO: "NAO_CADASTRADO",
  OUTRO: "OUTRO",
} as const;

export type TipoDivergenciaRecolhimento =
  (typeof TipoDivergenciaRecolhimento)[keyof typeof TipoDivergenciaRecolhimento];