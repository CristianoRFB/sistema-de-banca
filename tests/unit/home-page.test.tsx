import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { HorarioFuncionamento } from '../../src/domain/entities/HorarioFuncionamento';

const { listMock, profileMock } = vi.hoisted(() => ({ listMock: vi.fn(), profileMock: vi.fn() }));
vi.mock('../../src/features/catalogo/catalogo.repository', () => ({ catalogoRepository: { list: listMock } }));
vi.mock('../../src/features/banca/banca.service', () => ({ obterPerfilPublicoBanca: profileMock }));

import { HomePage } from '../../src/pages/public/HomePage';

const emptyPage = { itens: [], proximoCursor: null, temMais: false };

afterEach(() => {
  listMock.mockReset();
  profileMock.mockReset();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('página inicial', () => {
  it('mostra loading até receber o catálogo e separa catálogo vazio de carregamento', async () => {
    let resolveFeed!: (value: typeof emptyPage) => void;
    const feedPage = new Promise<typeof emptyPage>((resolve) => { resolveFeed = resolve; });
    listMock.mockResolvedValueOnce(emptyPage).mockReturnValueOnce(feedPage);
    profileMock.mockRejectedValue(new Error('offline'));

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando as novidades.');
    await act(async () => { resolveFeed(emptyPage); await feedPage; });
    expect(screen.getByText('Estamos preparando o catálogo.')).toBeInTheDocument();
    expect(screen.queryByText('Carregando as novidades.')).not.toBeInTheDocument();
  });

  it('permite repetir a consulta do catálogo após falha inicial', async () => {
    vi.stubEnv('DEV', false);
    listMock.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(emptyPage);
    profileMock.mockRejectedValue(new Error('offline'));

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o catálogo.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Estamos preparando o catálogo.')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(3);
  });

  it('calcula o estado de abertura usando os horários públicos editáveis', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 5, 8, 30)); // segunda-feira às 08:30
    listMock.mockResolvedValue(emptyPage);
    const hours: HorarioFuncionamento[] = Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, fechado: true, abre: null, fecha: null }));
    hours[1] = { diaSemana: 1, fechado: false, abre: '09:00', fecha: '17:00' };
    profileMock.mockResolvedValue({ nomeExibicao: 'Banca Ana Maria', slug: 'ana-maria', telefone: '+5517999990000', endereco: 'Rua Teste', fotoUrl: null, horarios: hours });

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByText('Fechada agora')).toBeInTheDocument();
  });
});
