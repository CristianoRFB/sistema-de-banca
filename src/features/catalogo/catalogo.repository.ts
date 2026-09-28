import { apiRequest } from '../../infra/browser/api-client';
import type { FiltrosCatalogo, PaginaCatalogo, ProdutoCatalogo } from './catalogo.types';

interface CatalogItemApi {
  id: string;
  itemReparteId: string;
  productId: string;
  title: string;
  volume: string | null;
  type: string;
  publisher: string | null;
  price: number | null;
  available: number;
  publishedAt: string | null;
  reservationCutoffAt: string | null;
  plannedCollectionAt: string | null;
  status: string;
}

function mapCatalogItem(item: CatalogItemApi): ProdutoCatalogo {
  const cutoffPassed = item.reservationCutoffAt !== null && Date.now() >= new Date(item.reservationCutoffAt).getTime();
  const validType = ['MANGA', 'REVISTA', 'BOX', 'COLECIONAVEL', 'OUTRO'].includes(item.type) ? item.type as ProdutoCatalogo['tipo'] : 'OUTRO';
  return {
    id: item.id,
    produtoId: item.productId,
    itemReparteId: item.itemReparteId,
    titulo: item.title,
    volume: item.volume,
    editora: item.publisher,
    tipo: validType,
    preco: item.price,
    quantidadeDisponivel: Number.isFinite(item.available) ? item.available : null,
    publicadoEm: item.publishedAt,
    dataFimReservas: item.reservationCutoffAt,
    dataRecolhimentoPrevista: item.plannedCollectionAt,
    permiteReserva: item.status === 'PUBLICADA' && item.available > 0 && !cutoffPassed,
  };
}

interface CatalogResponseApi {
  items: CatalogItemApi[];
  page: { nextCursor: string | null; limit?: number; hasMore?: boolean };
}

export const catalogoRepository = {
  async list(filtros: FiltrosCatalogo = { busca: '' }, cursor?: string | null): Promise<PaginaCatalogo> {
    const sort = filtros.ordenar === 'TITULO' ? 'title' : 'recent';
    const params = new URLSearchParams({
      q: filtros.busca.trim(),
      type: filtros.tipo && filtros.tipo !== 'TODOS' ? filtros.tipo : '',
      availability: filtros.disponibilidade === 'ULTIMAS_UNIDADES' ? 'low' : filtros.disponibilidade === 'DISPONIVEIS' ? 'available' : 'all',
      sort,
      limit: '24',
    });
    if (cursor) params.set('cursor', cursor);
    const response = await apiRequest<CatalogResponseApi>(`/public/catalog?${params}`);
    return { itens: response.items.map(mapCatalogItem), proximoCursor: response.page.nextCursor };
  },

  async get(itemReparteId: string): Promise<ProdutoCatalogo> {
    return mapCatalogItem(await apiRequest<CatalogItemApi>(`/public/catalog/${encodeURIComponent(itemReparteId)}`));
  },
};
