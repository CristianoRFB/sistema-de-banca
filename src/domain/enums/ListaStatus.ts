export const ListaStatus = {
  RASCUNHO: "RASCUNHO",
  PUBLICADA: "PUBLICADA",
  ENCERRADA: "ENCERRADA",
  ARQUIVADA: "ARQUIVADA",
} as const;

export type ListaStatus = (typeof ListaStatus)[keyof typeof ListaStatus];