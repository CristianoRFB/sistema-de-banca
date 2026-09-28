import type { ReparteStatus } from "../enums/ReparteStatus";

export interface Reparte {
  id: string;
  bancaId: string;
  fornecedorId: string | null;
  titulo: string;
  dataRecebimento: Date | null;
  dataRecolhimentoPrevista: Date | null;
  dataFimReservas: Date | null;
  margemSegurancaDias: number;
  status: ReparteStatus;
  criadaEm: Date;
  publicadaEm: Date | null;
  encerradaEm: Date | null;
}