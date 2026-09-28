export const RecolhimentoStatus = {
  PENDENTE: "PENDENTE",
  EM_CONFERENCIA: "EM_CONFERENCIA",
  COM_DIVERGENCIA: "COM_DIVERGENCIA",
  CONFIRMADO: "CONFIRMADO",
  ENCERRADO: "ENCERRADO",
} as const;

export type RecolhimentoStatus =
  (typeof RecolhimentoStatus)[keyof typeof RecolhimentoStatus];