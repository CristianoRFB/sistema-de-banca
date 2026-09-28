export const IntencaoRetirada = {
  SEM_RESPOSTA: "SEM_RESPOSTA",
  VOU_BUSCAR: "VOU_BUSCAR",
  ESTOU_INDO: "ESTOU_INDO",
  NAO_VOU: "NAO_VOU",
} as const;

export type IntencaoRetirada =
  (typeof IntencaoRetirada)[keyof typeof IntencaoRetirada];