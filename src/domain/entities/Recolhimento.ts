import type { RecolhimentoStatus } from "../enums/RecolhimentoStatus";

export interface Recolhimento {
  id: string;
  bancaId: string;
  reparteId: string;
  dataPrevista: Date;
  iniciadoEm: Date | null;
  confirmadoEm: Date | null;
  status: RecolhimentoStatus;
  observacoes: string | null;
}