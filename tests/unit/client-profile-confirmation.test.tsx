import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { searchMock, createSessionMock, publicProfileMock, saveSessionMock, sessionMock, createReservationMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  createSessionMock: vi.fn(),
  publicProfileMock: vi.fn(),
  saveSessionMock: vi.fn(),
  sessionMock: vi.fn(),
  createReservationMock: vi.fn(),
}));

vi.mock('../../src/features/cliente/cliente.repository', () => ({
  clienteRepository: { searchByName: searchMock, createOrResumeSession: createSessionMock },
}));
vi.mock('../../src/features/banca/banca.service', () => ({ obterPerfilPublicoBanca: publicProfileMock }));
vi.mock('../../src/infra/local-storage/cliente-session', () => ({
  lerSessaoCliente: sessionMock,
  salvarSessaoCliente: saveSessionMock,
}));
vi.mock('../../src/features/reservas/reserva.repository', () => ({
  reservaRepository: { create: createReservationMock },
}));

import { ToastProvider } from '../../src/components/ui/Toast';
import { BuscarPerfil } from '../../src/features/cliente/components/BuscarPerfil';
import { ReservarProdutoSheet } from '../../src/features/reservas/components/ReservarProdutoSheet';
import { ApiError } from '../../src/infra/browser/api-client';
import type { ProdutoCatalogo } from '../../src/features/catalogo/catalogo.types';

const confirmationError = 'Não foi possível confirmar o perfil. Revise nome e telefone ou fale com a banca.';
const product: ProdutoCatalogo = {
  id: 'product-1',
  produtoId: 'product-1',
  itemReparteId: 'stock-1',
  titulo: 'Wind Breaker',
  volume: '25',
  tipo: 'MANGA',
  preco: 12,
  quantidadeDisponivel: 2,
  permiteReserva: true,
};

afterEach(() => {
  cleanup();
  searchMock.mockReset();
  createSessionMock.mockReset();
  publicProfileMock.mockReset();
  saveSessionMock.mockReset();
  sessionMock.mockReset();
  sessionMock.mockReturnValue(null);
  createReservationMock.mockReset();
  localStorage.clear();
});

describe('confirmação de perfil do cliente', () => {
  it('mostra uma mensagem genérica para falha de confirmação no fluxo de perfil', async () => {
    const user = userEvent.setup();
    searchMock.mockResolvedValue([]);
    createSessionMock.mockRejectedValue(new ApiError('No profile matched those details.', 404, 'identity_not_found'));
    render(<BuscarPerfil onAuthenticated={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana Maria');
    await user.click(screen.getByRole('button', { name: 'Procurar perfil' }));
    await user.type(screen.getByRole('textbox', { name: /Telefone com DDD/ }), '17999990000');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(confirmationError);
    expect(screen.queryByText('No profile matched those details.')).not.toBeInTheDocument();
  });

  it('usa a mesma mensagem no fluxo de reserva e ignora submissões repetidas', async () => {
    const user = userEvent.setup();
    sessionMock.mockReturnValue(null);
    searchMock.mockResolvedValue([]);
    publicProfileMock.mockResolvedValue({ horarios: [] });
    let rejectSession!: (cause: Error) => void;
    createSessionMock.mockReturnValue(new Promise((_, reject) => { rejectSession = reject; }));

    render(<MemoryRouter><ToastProvider><ReservarProdutoSheet produto={product} open onClose={vi.fn()} /></ToastProvider></MemoryRouter>);

    await user.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana Maria');
    await user.click(screen.getByRole('button', { name: 'Procurar meu perfil' }));
    await user.type(screen.getByRole('textbox', { name: /Telefone com DDD/ }), '17999990000');
    const continueButton = screen.getByRole('button', { name: 'Continuar' });
    act(() => {
      continueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      continueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirmando…' })).toBeDisabled();
    await act(async () => {
      rejectSession(new ApiError('No profile matched those details.', 404, 'identity_not_found'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(confirmationError);
    expect(screen.queryByText('No profile matched those details.')).not.toBeInTheDocument();
  });

  it('envia uma única reserva mesmo com dois cliques enquanto a primeira está pendente', async () => {
    const user = userEvent.setup();
    sessionMock.mockReturnValue({ token: 'client-session', clienteId: 'client-1', nome: 'Ana Maria' });
    const hours = Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, fechado: false, abre: '00:00', fecha: '23:59' }));
    publicProfileMock.mockResolvedValue({ horarios: hours });
    let resolveReservation!: (value: object) => void;
    const pendingReservation = new Promise<object>((resolve) => { resolveReservation = resolve; });
    createReservationMock.mockReturnValue(pendingReservation);

    render(<MemoryRouter><ToastProvider><ReservarProdutoSheet produto={product} open onClose={vi.fn()} /></ToastProvider></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: /Amanhã/ }));
    const submit = screen.getByRole('button', { name: 'Confirmar reserva' });
    await waitFor(() => expect(submit).toBeEnabled());
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createReservationMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Confirmando/ })).toBeDisabled();
    await act(async () => { resolveReservation({}); await pendingReservation; });
  });
});
