import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogoRepository } from '../../src/features/catalogo/catalogo.repository';

const apiItem = {
  id: 'catalog-row-1',
  itemReparteId: 'stock-1',
  productId: 'product-1',
  title: 'Wistoria',
  volume: '09',
  type: 'MANGA',
  publisher: 'Editora de Teste',
  price: 12.5,
  available: 2,
  publishedAt: '2026-09-29T12:00:00.000Z',
  reservationCutoffAt: null,
  plannedCollectionAt: '2026-10-20T12:00:00.000Z',
  status: 'AVAILABLE' as const,
};

function mockFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('repositório do catálogo público', () => {
  it('desembrulha a resposta data.item e habilita reserva com status AVAILABLE', async () => {
    mockFetch({ data: { item: apiItem } });

    const product = await catalogoRepository.get('stock-1');

    expect(product).toMatchObject({
      id: 'catalog-row-1',
      itemReparteId: 'stock-1',
      titulo: 'Wistoria',
      quantidadeDisponivel: 2,
      permiteReserva: true,
    });
  });

  it('não habilita reserva quando o Worker retorna SOLD_OUT', async () => {
    mockFetch({ data: { item: { ...apiItem, available: 0, status: 'SOLD_OUT' } } });

    const product = await catalogoRepository.get('stock-1');

    expect(product.quantidadeDisponivel).toBe(0);
    expect(product.permiteReserva).toBe(false);
  });

  it('retorna cursor e sinaliza mais páginas, enviando busca e tipo para o servidor', async () => {
    const fetchMock = mockFetch({ data: { items: [apiItem], page: { limit: 24, nextCursor: 'next-page', hasMore: true } } });

    const page = await catalogoRepository.list({
      busca: 'Wistória',
      tipo: 'MANGA',
      disponibilidade: 'DISPONIVEIS',
      ordenar: 'RECENTES',
    }, 'start-page');

    expect(page.proximoCursor).toBe('next-page');
    expect(page.temMais).toBe(true);
    expect(page.itens[0].permiteReserva).toBe(true);
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://banca.example.test');
    expect(url.searchParams.get('q')).toBe('Wistória');
    expect(url.searchParams.get('type')).toBe('MANGA');
    expect(url.searchParams.get('availability')).toBe('available');
    expect(url.searchParams.get('cursor')).toBe('start-page');
  });
});
