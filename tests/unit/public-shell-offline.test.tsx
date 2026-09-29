import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicShell } from '../../src/app/layouts/PublicShell';
import { apiRequest } from '../../src/infra/browser/api-client';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('aviso offline da área pública', () => {
  it('informa quando o navegador fica sem conexão', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    render(<MemoryRouter><PublicShell /></MemoryRouter>);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));

    expect(screen.getByRole('status')).toHaveTextContent(/catálogo podem estar desatualizados/i);
    expect(screen.getByRole('status')).toHaveTextContent(/exigem internet/i);
  });

  it('sinaliza o fallback de cache mesmo se o navegador ainda indicar conexão', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    render(<MemoryRouter><PublicShell /></MemoryRouter>);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [] } }), {
      status: 200,
      headers: { 'x-public-data-cache': 'fallback' },
    })));

    await act(async () => apiRequest('/public/catalog'));
    expect(await screen.findByRole('status')).toHaveTextContent(/conteúdo público salvo/i);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [] } }), { status: 200 })));
    await act(async () => apiRequest('/public/catalog'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
