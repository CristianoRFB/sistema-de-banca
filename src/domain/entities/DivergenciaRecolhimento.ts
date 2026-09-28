import type { TipoDivergenciaRecolhimento } from "../enums/TipoDivergenciaRecolhimento";

export interface DivergenciaRecolhimento {
  id: string;
  bancaId: string;
  recolhimentoId: string;
  itemReparteId: string;
  tipo: TipoDivergenciaRecolhimento;
  esperado: number;
  encontrado: number;
  resolucao: string | null;
  resolvida: boolean;
  criadaEm: Date;
  resolvidaEm: Date | null;
}