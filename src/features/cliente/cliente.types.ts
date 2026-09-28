export interface PerfilMascarado {
  clienteId: string;
  nome: string;
  telefoneMascarado: string;
}

export interface PerfilCliente {
  clienteId: string;
  nome: string;
}

export interface SessaoCliente extends PerfilCliente {
  token: string;
}

export interface ReservaCliente {
  id: string;
  criadaEm: string;
  dataRetiradaPretendida: string;
  horarioAproximado?: string | null;
  expiraEm: string;
  status: 'ATIVA' | 'PARCIALMENTE_RETIRADA' | 'CONCLUIDA' | 'CANCELADA' | 'EXPIRADA';
  intencaoRetirada: 'SEM_RESPOSTA' | 'VOU_BUSCAR' | 'ESTOU_INDO' | 'NAO_VOU';
  itens: Array<{ itemReservaId: string; itemReparteId: string; titulo: string; volume?: string | null; quantidade: number; quantidadeRetirada: number }>;
}
