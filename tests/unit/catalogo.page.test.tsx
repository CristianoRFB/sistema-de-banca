import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PaginaCatalogo, ProdutoCatalogo } from '../../src/features/catalogo/catalogo.types';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../../src/features/catalogo/catalogo.repository', () => ({
  catalogoRepository: { list: listMock, get: vi.fn() },
}));

import { CatalogoPage } from '../../src/pages/public/CatalogoPage';

function product(id: string, title: string): ProdutoCatalogo {
  return {
    id,
    produtoId: `product-${id}`,
    itemReparteId: `stock-${id}`,
    titulo: title,
    volume: null,
    tipo: 'MANGA',
    preco: 12,
    quantidadeDisponivel: 5,
    permiteReserva: true,
  };
}

afterEach(() => {
  cleanup();
  listMock.mockReset();
  vi.unstubAllEnvs();
});

describe('página de catálogo', () => {
  it('carrega a próxima página do servidor e acrescenta os resultados', async () => {
    const firstPage: PaginaCatalogo = { itens: [product('1', 'Wistoria')], proximoCursor: 'cursor-2', temMais: true };
    const secondPage: PaginaCatalogo = { itens: [product('2', 'Wind Breaker')], proximoCursor: null, temMais: false };
    listMock.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    render(<MemoryRouter initialEntries={['/catalogo']}>
      <Routes><Route path="/catalogo" element={<CatalogoPage />} /></Routes>
    </MemoryRouter>);

    expect(await screen.findByText('Wistoria')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais títulos' }));
    expect(await screen.findByText('Wind Breaker')).toBeInTheDocument();
    expect(listMock).toHaveBeenNthCalledWith(2, {
      busca: '',
      tipo: 'TODOS',
      disponibilidade: 'TODOS',
      ordenar: 'RECENTES',
    }, 'cursor-2');
    expect(screen.queryByRole('button', { name: 'Carregar mais títulos' })).not.toBeInTheDocument();
  });

  it('oferece retry após falha inicial e anuncia o filtro selecionado', async () => {
    vi.stubEnv('DEV', false);
    listMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      itens: [product('1', 'Wistoria')],
      proximoCursor: null,
      temMais: false,
    });

    render(<MemoryRouter initialEntries={['/catalogo']}>
      <Routes><Route path="/catalogo" element={<CatalogoPage />} /></Routes>
    </MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o catálogo.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Wistoria')).toBeInTheDocument();

    const mangaFilter = screen.getByRole('button', { name: 'Mangá' });
    expect(mangaFilter).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mangaFilter);
    expect(mangaFilter).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3));
  });
});
