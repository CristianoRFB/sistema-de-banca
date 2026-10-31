import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginAdminPage } from '../../src/pages/admin/LoginAdminPage';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn() }));

vi.mock('../../src/app/providers', () => ({
  useAdminAuth: () => ({ user: null, loading: false, configured: true }),
}));
vi.mock('../../src/features/banca/tenant-bootstrap', () => ({
  getTenantBootstrap: mocks.bootstrap,
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/banca-a/painel/login']}>
      <Routes>
        <Route path="/:tenantSlug/painel/login" element={<LoginAdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { mocks.bootstrap.mockReset(); });
afterEach(() => cleanup());

describe('tenant-bound admin login', () => {
  it('does not present a credentials form while tenant identity is still unverified', async () => {
    let resolve!: (value: unknown) => void;
    mocks.bootstrap.mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderLogin();
    expect(screen.getByRole('status')).toHaveTextContent('Confirmando a banca antes do login');
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    resolve({
      id: 'tenant-a', slug: 'banca-a', active: true, name: 'Banca A',
      address: null, phone: null, photoUrl: null,
      branding: { primaryColor: null, accentColor: null, backgroundColor: null, textColor: null, logoUrl: null, tagline: null },
    });
    expect(await screen.findByLabelText('Senha')).toBeInTheDocument();
  });

  it('fails closed when the tenant cannot be loaded', async () => {
    mocks.bootstrap.mockRejectedValueOnce(new Error('unknown tenant'));
    renderLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar esta banca.');
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('rejects an active response for a different tenant', async () => {
    mocks.bootstrap.mockResolvedValueOnce({ id: 'tenant-b', slug: 'banca-b', active: true });
    renderLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar esta banca.');
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  });

  it('shows the login form only after the matching active tenant is verified', async () => {
    mocks.bootstrap.mockResolvedValueOnce({
      id: 'tenant-a', slug: 'banca-a', active: true, name: 'Banca A',
      address: null, phone: null, photoUrl: null,
      branding: { primaryColor: null, accentColor: null, backgroundColor: null, textColor: null, logoUrl: null, tagline: null },
    });
    renderLogin();
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByText('Banca A')).toBeInTheDocument();
  });
});
