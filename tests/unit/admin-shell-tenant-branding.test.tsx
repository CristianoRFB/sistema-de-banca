import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell } from '../../src/app/layouts/AdminShell';

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn() }));
vi.mock('../../src/features/banca/tenant-bootstrap', () => ({ getTenantBootstrap: mocks.bootstrap }));
vi.mock('../../src/app/providers', () => ({ useAdminAuth: () => ({ user: null }) }));
vi.mock('../../src/infra/firebase/auth', () => ({ logoutAdmin: vi.fn() }));

const base = {
  id: 'tenant-a', slug: 'banca-a', name: 'Banca A', active: true,
  phone: null, address: null, photoUrl: null,
  branding: { primaryColor: '#112233', accentColor: null,
    backgroundColor: null, textColor: null, logoUrl: null, tagline: null },
};

function mount() {
  return render(
    <MemoryRouter initialEntries={['/banca-a/painel']}>
      <Routes>
        <Route path="/:tenantSlug/painel" element={<AdminShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => mocks.bootstrap.mockReset());
afterEach(() => cleanup());

describe('tenant admin shell branding boundary', () => {
  it('never uses branding returned for another tenant', async () => {
    mocks.bootstrap.mockResolvedValueOnce({
      ...base, id: 'tenant-b', slug: 'banca-b', name: 'Banca B',
      branding: { ...base.branding, primaryColor: '#ff0000' },
    });
    const { container } = mount();
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
    expect(screen.queryByText('Banca B')).not.toBeInTheDocument();
    expect(container.querySelector('.admin-shell')?.getAttribute('style') ?? '').not.toContain('#ff0000');
  });

  it('applies branding only for a matching active tenant', async () => {
    mocks.bootstrap.mockResolvedValueOnce(base);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.admin-shell')?.getAttribute('style') ?? '').toContain('#112233'));
    expect(screen.getByText('Banca A')).toBeInTheDocument();
  });

  it('does not display disabled tenant branding', async () => {
    mocks.bootstrap.mockResolvedValueOnce({ ...base, active: false });
    const { container } = mount();
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
    expect(screen.queryByText('Banca A')).not.toBeInTheDocument();
    expect(container.querySelector('.admin-shell')?.getAttribute('style') ?? '').not.toContain('#112233');
  });
});
