import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { PublicShell } from '../../src/app/layouts/PublicShell';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
}));

vi.mock('../../src/features/banca/tenant-bootstrap', () => ({
  getTenantBootstrap: mocks.bootstrap,
}));

const tenantA = {
  id: 'tenant-a', slug: 'banca-a', name: 'Banca A',
  phone: '+55 11 99999-1111', address: 'Rua A, 1',
  photoUrl: null, active: true,
  branding: { primaryColor: '#112233', accentColor: null, backgroundColor: null, textColor: null, logoUrl: null, tagline: null },
};
const tenantB = {
  ...tenantA, id: 'tenant-b', slug: 'banca-b', name: 'Banca B',
  phone: '+55 11 99999-2222', address: 'Rua B, 2',
  branding: { ...tenantA.branding, primaryColor: '#334455' },
};

function Boundary() {
  const { tenantSlug } = useParams();
  return <PublicShell key={tenantSlug} />;
}
function PageLinks() {
  return <section><Link to="/banca-b">Ir à Banca B</Link><Link to="/banca-a">Ir à Banca A</Link><Outlet /></section>;
}
function renderPublic(initial = '/banca-a') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<PageLinks />}>
          <Route path="/:tenantSlug" element={<Boundary />}>
            <Route index element={<div>Página pública verificada</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());
beforeEach(() => { mocks.bootstrap.mockReset(); });

describe('public tenant boundary', () => {
  it('only renders public pages once the matching tenant is verified', async () => {
    let resolve!: (value: typeof tenantA) => void;
    mocks.bootstrap.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderPublic();
    expect(screen.getByRole('status')).toHaveTextContent('Confirmando a banca');
    expect(screen.queryByText('Página pública verificada')).not.toBeInTheDocument();
    resolve(tenantA);
    await screen.findByText('Página pública verificada');
    expect(screen.getByRole('link', { name: /Banca A, início/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/5511999991111');
  });

  it('fails closed when backend bootstrap is unavailable or names a different tenant', async () => {
    mocks.bootstrap.mockResolvedValueOnce(tenantB);
    renderPublic('/banca-a');
    await screen.findByRole('alert');
    expect(screen.queryByText('Página pública verificada')).not.toBeInTheDocument();
    expect(screen.queryByText('Banca A')).not.toBeInTheDocument();
    expect(screen.queryByText('Banca B')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it('does not expose previous tenant contact on SPA navigation while B is loading', async () => {
    let resolveB!: (value: typeof tenantB) => void;
    mocks.bootstrap.mockResolvedValueOnce(tenantA)
      .mockImplementationOnce(() => new Promise((done) => { resolveB = done; }));
    renderPublic('/banca-a');
    await screen.findByRole('link', { name: /Banca A, início/ });
    await userEvent.click(screen.getByRole('link', { name: 'Ir à Banca B' }));
    expect(screen.queryByRole('link', { name: /Banca A, início/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Página pública verificada')).not.toBeInTheDocument();
    resolveB(tenantB);
    await waitFor(() => expect(screen.getByRole('link', { name: /Banca B, início/ })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/5511999992222');
    expect(screen.queryByText('Rua A, 1')).not.toBeInTheDocument();
  });

  it('does not render links for unsupported tenants and can retry a failed bootstrap', async () => {
    mocks.bootstrap.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(tenantA);
    renderPublic();
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('link', { name: /Banca A, início/ });
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);
  });
});
