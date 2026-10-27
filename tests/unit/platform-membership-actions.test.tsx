import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  let membershipActive = true;

  beforeEach(() => {
    vi.clearAllMocks();
    membershipActive = true;
    vi.stubGlobal('confirm', mocks.confirm);
    mocks.apiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/platform/tenants' && !init) {
        return { tenants: [{ id: 'tenant-a', slug: 'banca-ana-maria', name: 'Banca A', active: true, createdAt: null, updatedAt: null }] };
      }
      if (path === '/platform/tenants/tenant-a/memberships' && !init) {
        return { memberships: [{ uid: 'operator-one', role: 'STAFF', active: membershipActive }] };
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
});
