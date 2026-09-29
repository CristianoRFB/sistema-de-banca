import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProdutoCatalogo } from '../../src/features/catalogo/catalogo.types';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../../src/features/catalogo/catalogo.repository', () => ({ catalogoRepository: { get: getMock } }));
vi.mock('../../src/features/reservas/components/ReservarProdutoSheet', () => ({ ReservarProdutoSheet: () => null }));

import { ApiError } from '../../src/infra/browser/api-client';
import { ProdutoPage } from '../../src/pages/public/ProdutoPage';

const product: ProdutoCatalogo = {
  id: 'item-1',
  produtoId: 'product-1',
  itemReparteId: 'stock-1',
  titulo: 'Wind Breaker',
  volume: '25',
  tipo: 'MANGA',
  preco: 12,
  quantidadeDisponivel: 2,
  permiteReserva: true,
};

function renderProductPage() {
  return render(<MemoryRouter initialEntries={['/produto/stock-1']}>
    <Routes><Route path="/produto/:itemReparteId" element={<ProdutoPage />} /></Routes>
  </MemoryRouter>);
}

afterEach(() => getMock.mockReset());

describe('página do produto', () => {
  it('distingue falha de serviço de título inexistente e permite repetir', async () => {
    getMock.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(product);

    renderProductPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir este título.');
    expect(screen.queryByText('TÍTULO NÃO ENCONTRADO')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { name: /Wind Breaker/ })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('exibe “não encontrado” somente para resposta 404', async () => {
    getMock.mockRejectedValueOnce(new ApiError('not found', 404, 'not_found'));

    renderProductPage();

    expect(await screen.findByText('TÍTULO NÃO ENCONTRADO')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });
});
