export const TipoProduto = {
  MANGA: "MANGA",
  REVISTA: "REVISTA",
  BOX: "BOX",
  COLECIONAVEL: "COLECIONAVEL",
  OUTRO: "OUTRO",
} as const;

export type TipoProduto = (typeof TipoProduto)[keyof typeof TipoProduto];