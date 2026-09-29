import type { TipoProduto } from '../../domain/enums/TipoProduto';

export type { TipoProduto };

export interface ProdutoCatalogo {
  id: string;
  produtoId: string;
  itemReparteId: string;
  titulo: string;
  tituloNormalizado?: string;
  nomeOriginal?: string | null;
  volume?: string | null;
  editora?: string | null;
  tipo: TipoProduto;
  sinopse?: string | null;
  capaUrl?: string | null;
  preco?: number | null;
  quantidadeDisponivel: number | null;
  dataFimReservas?: string | null;
  dataRecolhimentoPrevista?: string | null;
  publicadoEm?: string | null;
  permiteReserva: boolean;
  demonstracao?: boolean;
}

export interface PaginaCatalogo {
  itens: ProdutoCatalogo[];
  proximoCursor: string | null;
  temMais: boolean;
  banca?: {
    nomeExibicao: string;
    cidade: string;
  };
}

export interface FiltrosCatalogo {
  busca: string;
  tipo?: TipoProduto | 'TODOS';
  disponibilidade?: 'TODOS' | 'DISPONIVEIS' | 'ULTIMAS_UNIDADES';
  ordenar?: 'RECENTES' | 'TITULO' | 'VOLUME';
}
