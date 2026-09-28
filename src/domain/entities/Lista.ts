import type { ListaStatus } from "../enums/ListaStatus";

export interface Lista {
  id: string;
  bancaId: string;
  reparteId: string | null;
  titulo: string;
  slug: string;
  status: ListaStatus;
  criadaEm: Date;
  publicadaEm: Date | null;
  encerradaEm: Date | null;
  versao: number;
}