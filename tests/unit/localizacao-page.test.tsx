import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalizacaoPage } from '../../src/pages/public/LocalizacaoPage';

describe('public bank location', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the current public bank profile and opening hours', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      profile: { name: 'Banca Ana Maria', slug: 'ana-maria', phone: '+55 17 90000-1111', address: 'Rua de Teste, 123', photoUrl: null },
      hours: [{ dayOfWeek: 1, closed: false, opensAt: '09:00', closesAt: '17:30' }, { dayOfWeek: 2, closed: true, opensAt: null, closesAt: null }],
    } }), { status: 200, headers: { 'content-type': 'application/json' } })));

    render(<LocalizacaoPage />);

    await waitFor(() => expect(screen.getByText('Rua de Teste, 123')).toBeInTheDocument());
    expect(screen.getByText('Segunda-feira')).toBeInTheDocument();
    expect(screen.getByText('09:00–17:30')).toBeInTheDocument();
    expect(screen.getByText('Terça-feira')).toBeInTheDocument();
    expect(screen.getByText('Fechado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir rota no mapa/i })).toHaveAttribute('href', expect.stringContaining('Rua%20de%20Teste%2C%20123'));
    expect(screen.getByRole('link', { name: /WhatsApp/i })).toHaveAttribute('href', 'https://wa.me/5517900001111');
  });
});
