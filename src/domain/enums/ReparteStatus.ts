export const ReparteStatus = {
  RASCUNHO: "RASCUNHO",
  ATIVO: "ATIVO",
  AGUARDANDO_RECOLHIMENTO: "AGUARDANDO_RECOLHIMENTO",
  ENCERRADO: "ENCERRADO",
  ARQUIVADO: "ARQUIVADO",
} as const;

export type ReparteStatus = (typeof ReparteStatus)[keyof typeof ReparteStatus];