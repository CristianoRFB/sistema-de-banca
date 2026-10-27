import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PlatformAdminPage } from '../../src/pages/platform/PlatformAdminPage';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  confirm: vi.fn(() => true),
}));

vi.mock('../../src/app/providers', () => ({
  useAdminAuth: () => ({ user: { getIdToken: async () => 'test-token' } }),
}));
vi.mock('../../src/infra/browser/api-client', () => ({
  apiRequest: mocks.apiRequest,
  jsonBody: (value: unknown) => ({ method: 'POST', body: JSON.stringify(value) }),
}));
vi.mock('../../src/infra/firebase/auth', () => ({ logoutAdmin: vi.fn() }));

describe('Platform Owner membership administration', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  let membershipActive = true;
  let supportActive = false;

  beforeEach(() => {
    vi.clearAllMocks();
    membershipActive = true;
    supportActive = false;
    vi.stubGlobal('confirm', mocks.confirm);
    mocks.apiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/platform/tenants' && (init?.method ?? 'GET') === 'GET') {
        return { tenants: [{ id: 'tenant-a', slug: 'banca-ana-maria', name: 'Banca A', active: true, createdAt: null, updatedAt: null }] };
      }
      if (path === '/platform/tenants/tenant-a/memberships' && (init?.method ?? 'GET') === 'GET') {
        return { memberships: [{ uid: 'operator-one', role: 'STAFF', active: membershipActive }] };
      }
      if (path === '/platform/tenants/tenant-a/support') {
        if ((init?.method ?? 'GET') === 'GET') return { grant: { active: supportActive, expiresAt: null, reason: null } };
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { reason: string; durationMinutes: number };
          supportActive = true;
          return { grant: { active: true, expiresAt: new Date(Date.now() + body.durationMinutes * 60_000).toISOString(), reason: body.reason } };
        }
        if (init?.method === 'DELETE') {
          supportActive = false;
          return { grant: { active: false, expiresAt: null, reason: null } };
        }
      }
      if (path === '/platform/tenants/tenant-a/memberships/operator-one' && init?.method === 'PUT') {
        membershipActive = (JSON.parse(String(init.body)) as { active: boolean }).active;
        return { membership: { uid: 'operator-one', role: 'STAFF', active: membershipActive } };
      }
      throw new Error('Unexpected platform API request: ' + path);
    });
  });

  it('revokes and reactivates a membership using the audited server endpoint', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Acessos' }));
    await user.click(await screen.findByRole('button', { name: 'Revogar acesso de operator-one' }));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(membershipActive).toBe(false));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships/operator-one',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'STAFF', active: false }) }),
    );
    await user.click(await screen.findByRole('button', { name: 'Reativar acesso de operator-one' }));
    await waitFor(() => expect(membershipActive).toBe(true));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships/operator-one',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'STAFF', active: true }) }),
    );
  });

  it('does not revoke a membership when cancellation is selected', async () => {
    mocks.confirm.mockReturnValueOnce(false);
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Acessos' }));
    await user.click(await screen.findByRole('button', { name: 'Revogar acesso de operator-one' }));
    expect(membershipActive).toBe(true);
    expect(mocks.apiRequest).not.toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships/operator-one',
      expect.anything(),
    );
  });
  it('requires a reason before granting read-only support and lets the owner revoke it', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Acessos' }));
    const grantButton = await screen.findByRole('button', { name: 'Conceder suporte somente leitura' });
    expect(grantButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Explique a necessidade de acesso aos dados da banca'), 'Verificar problema operacional relatado');
    expect(grantButton).toBeEnabled();
    await user.click(grantButton);
    await waitFor(() => expect(supportActive).toBe(true));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/support',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({
        reason: 'Verificar problema operacional relatado', durationMinutes: 15,
      }) }),
    );
    await user.click(await screen.findByRole('button', { name: 'Revogar suporte' }));
    await waitFor(() => expect(supportActive).toBe(false));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/support',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

});
