import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
// Membership tests exercise the access-management UI; audit has its own suite.
vi.mock('../../src/pages/platform/PlatformAuditSection', () => ({ PlatformAuditSection: () => null }));

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

  it('requires an explicitly provisioned Firebase owner UID when creating a tenant', async () => {
    mocks.apiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/platform/tenants' && (init?.method ?? 'GET') === 'GET') return { tenants: [] };
      if (path === '/platform/tenants' && init?.method === 'POST') {
        return { tenant: { id: 'new-tenant', slug: 'tenant-novo' } };
      }
      throw new Error('Unexpected platform API request: ' + path);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    const create = screen.getByRole('button', { name: 'Criar tenant com proprietário' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Nome'), 'Banca Nova');
    await user.type(screen.getByLabelText('Slug'), 'tenant-novo');
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Firebase Auth UID do Tenant Owner'), 'uid-dono-123');
    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Banca Nova', slug: 'tenant-novo', initialOwnerUid: 'uid-dono-123' }),
      }),
    ));
  });

  it('revokes and reactivates a membership using the audited server endpoint', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Acessos' }));
    const revoke = await screen.findByRole('button', { name: 'Revogar acesso de operator-one' });
    await waitFor(() => expect(revoke).toBeEnabled());
    await user.click(revoke);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(membershipActive).toBe(false));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships/operator-one',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'STAFF', active: false }) }),
    );
    const reactivate = await screen.findByRole('button', { name: 'Reativar acesso de operator-one' });
    await waitFor(() => expect(reactivate).toBeEnabled());
    await user.click(reactivate);
    await waitFor(() => expect(membershipActive).toBe(true));
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships/operator-one',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'STAFF', active: true }) }),
    );
  });

  it('loads additional membership pages and retains earlier access rows', async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/platform/tenants') return {
        tenants: [{ id: 'tenant-a', slug: 'banca-a', name: 'Banca A', active: true }],
      };
      if (path === '/platform/tenants/tenant-a/memberships') return {
        memberships: [{ uid: 'user-first', role: 'STAFF', active: true }],
        page: { nextCursor: 'user-first' },
      };
      if (path === '/platform/tenants/tenant-a/memberships?cursor=user-first') return {
        memberships: [{ uid: 'user-second', role: 'ADMIN', active: false }],
        page: { nextCursor: null },
      };
      if (path === '/platform/tenants/tenant-a/support') {
        return { grant: { active: false, expiresAt: null, reason: null } };
      }
      throw new Error('Unexpected API request: ' + path);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Acessos' }));
    expect(await screen.findByText('user-first')).toBeInTheDocument();
    const more = await screen.findByRole('button', { name: 'Carregar mais acessos' });
    await waitFor(() => expect(more).toBeEnabled());
    await user.click(more);
    await screen.findByText('user-second');
    expect(screen.getByText('user-first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais acessos' })).not.toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships?cursor=user-first',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('clears tenant A access records before loading another tenant that fails', async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/platform/tenants') return { tenants: [
        { id: 'tenant-a', slug: 'banca-a', name: 'Banca A', active: true },
        { id: 'tenant-b', slug: 'banca-b', name: 'Banca B', active: true },
      ] };
      if (path === '/platform/tenants/tenant-a/memberships') return {
        memberships: [{ uid: 'only-in-a', role: 'STAFF', active: true }],
      };
      if (path === '/platform/tenants/tenant-a/support') {
        return { grant: { active: false, expiresAt: null, reason: null } };
      }
      if (path === '/platform/tenants/tenant-b/memberships') throw new Error('Tenant B unavailable');
      throw new Error('Unexpected API request: ' + path);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    const accessButtons = await screen.findAllByRole('button', { name: 'Acessos' });
    await user.click(accessButtons[0]);
    await screen.findByText('only-in-a');
    await waitFor(() => expect(accessButtons[1]).toBeEnabled());
    await user.click(accessButtons[1]);
    await screen.findByRole('alert');
    expect(screen.queryByText('only-in-a')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Tenant B unavailable');
  });

  it('ignores a delayed membership response for a previous bank after switching tenants', async () => {
    let finishA!: (value: unknown) => void;
    const first = new Promise((resolve) => { finishA = resolve; });
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/platform/tenants') return Promise.resolve({ tenants: [
        { id: 'tenant-a', slug: 'banca-a', name: 'Banca A', active: true },
        { id: 'tenant-b', slug: 'banca-b', name: 'Banca B', active: true },
      ] });
      if (path === '/platform/tenants/tenant-a/memberships') return first;
      if (path === '/platform/tenants/tenant-b/memberships') return Promise.resolve({
        memberships: [{ uid: 'only-in-b', role: 'ADMIN', active: true }],
      });
      if (path === '/platform/tenants/tenant-b/support') return Promise.resolve({
        grant: { active: false, expiresAt: null, reason: null },
      });
      throw new Error('Unexpected API request: ' + path);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    const buttons = await screen.findAllByRole('button', { name: 'Acessos' });
    await user.click(buttons[0]);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/memberships', expect.anything(),
    ));
    expect(buttons[1]).toBeEnabled();
    await user.click(buttons[1]);
    await screen.findByText('only-in-b');
    await act(async () => {
      finishA({ memberships: [{ uid: 'only-in-a', role: 'TENANT_OWNER', active: true }] });
    });
    expect(screen.getByText('only-in-b')).toBeInTheDocument();
    expect(screen.queryByText('only-in-a')).not.toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalledWith('/platform/tenants/tenant-a/support', expect.anything());
  });

  it('ignores stale support permissions when switching banks before the old request resolves', async () => {
    let finishSupportA!: (value: unknown) => void;
    const first = new Promise((resolve) => { finishSupportA = resolve; });
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/platform/tenants') return Promise.resolve({ tenants: [
        { id: 'tenant-a', slug: 'banca-a', name: 'Banca A', active: true },
        { id: 'tenant-b', slug: 'banca-b', name: 'Banca B', active: true },
      ] });
      if (path.endsWith('/memberships')) return Promise.resolve({
        memberships: [{ uid: path.includes('tenant-a') ? 'owner-a' : 'owner-b', role: 'TENANT_OWNER', active: true }],
      });
      if (path === '/platform/tenants/tenant-a/support') return first;
      if (path === '/platform/tenants/tenant-b/support') return Promise.resolve({
        grant: { active: false, expiresAt: null, reason: null },
      });
      throw new Error('Unexpected API request: ' + path);
    });
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    const buttons = await screen.findAllByRole('button', { name: 'Acessos' });
    await user.click(buttons[0]);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/tenants/tenant-a/support', expect.anything(),
    ));
    await user.click(buttons[1]);
    await screen.findByText('owner-b');
    await act(async () => {
      finishSupportA({ grant: {
        active: true, expiresAt: new Date(Date.now() + 60000).toISOString(), reason: 'Support for A',
      } });
    });
    expect(screen.getByText('owner-b')).toBeInTheDocument();
    expect(screen.queryByText('owner-a')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revogar suporte' })).not.toBeInTheDocument();
  });

  it('does not revoke a membership when cancellation is selected', async () => {
    mocks.confirm.mockReturnValueOnce(false);
    const user = userEvent.setup();
    render(<MemoryRouter><PlatformAdminPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Acessos' }));
    const revoke = await screen.findByRole('button', { name: 'Revogar acesso de operator-one' });
    await waitFor(() => expect(revoke).toBeEnabled());
    await user.click(revoke);
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
