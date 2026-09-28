import type { ItemReservaStatus } from "../enums/ItemReservaStatus";

/** Cada linha fixa a origem do estoque para manter rastreabilidade entre lotes. */
export interface ItemReserva {
  id: string;
  reservaId: string;
  bancaId: string;
  itemReparteId: string;
  produtoId: string;
  quantidade: number;
  quantidadeRetirada: number;
  precoUnitarioSnapshot: number | null;
  status: ItemReservaStatus;
  criadaEm: Date;
  atualizadaEm: Date;
}