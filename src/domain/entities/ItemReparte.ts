import type { ItemReparteStatus } from "../enums/ItemReparteStatus";

export interface ItemReparte {
  id: string;
  bancaId: string;
  reparteId: string;
  produtoId: string;
  tituloSnapshot: string;
  volumeSnapshot: string | null;
  precoVenda: number | null;
  quantidadeRecebida: number;
  quantidadeReservada: number;
  quantidadeRetirada: number;
  quantidadeDevolvida: number;
  dataRecolhimentoOverride: Date | null;
  dataFimReservas: Date | null;
  status: ItemReparteStatus;
  publicadoEm: Date | null;
}