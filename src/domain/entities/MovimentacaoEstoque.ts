import type { TipoMovimentacao } from "../enums/TipoMovimentacao";

export interface MovimentacaoEstoque {
  id: string;
  bancaId: string;
  itemReparteId: string;
  itemReservaId: string | null;
  tipo: TipoMovimentacao;
  quantidade: number;
  saldoAntes: number | null;
  saldoDepois: number | null;
  motivo: string | null;
  criadoEm: Date;
  usuarioId: string | null;
}