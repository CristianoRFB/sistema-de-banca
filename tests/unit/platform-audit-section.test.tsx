import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAuditSection } from '../../src/pages/platform/PlatformAuditSection';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const signedIn = { getIdToken: async () => 'platform-test-token' };
vi.mock('../../src/app/providers', () => ({
  useAdminAuth: () => ({ user: signedIn }),
}));
vi.mock('../../src/infra/browser/api-client', () => ({ apiRequest: mocks.apiRequest }));

const tenants = [
  { id: 'tenant-a', name: 'Banca A' },
  { id: 'tenant-b', name: 'Banca B' },
];

const aEvent = {
  id: 'audit-a', action: 'TENANT_CREATED', actorUid: 'owner-uid', tenantId: 'tenant-a',
  entityId: 'tenant-a', createdAt: '2026-10-30T12:00:00.000Z',
};
const bEvent = {
  id: 'audit-b', action: 'MEMBERSHIP_UPDATED', actorUid: 'owner-uid', tenantId: 'tenant-b',
  entityId: 'staff-b', createdAt: '2026-10-29T12:00:00.000Z',
};

beforeEach(() => { mocks.apiRequest.mockReset(); });
afterEach(() => { cleanup(); });

function renderSection() {
  return render(<PlatformAuditSection tenants={tenants} />);
}

describe('Platform Owner audit section', () => {
  it('loads additional audit events and filters by tenant without mixing events', async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => {
      const query = new URL('https://example.test' + path).searchParams;
      if (query.get('tenantId') === 'tenant-b') {
        return { events: [bEvent], page: { nextCursor: null, hasMore: false, limit: 20 } };
      }
      if (query.has('cursor')) {
        return { events: [bEvent], page: { nextCursor: null, hasMore: false, limit: 20 } };
      }
      return { events: [aEvent], page: { nextCursor: '2026-10-30T12:00:00.000Z|audit-a', hasMore: true, limit: 20 } };
    });
    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByText('Banca criada')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Carregar mais eventos' });
    await user.click(more);
    expect(await screen.findByText('Acesso atualizado')).toBeInTheDocument();
    expect(screen.getByText('Banca criada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais eventos' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar auditoria por banca' }), 'tenant-b');
    await waitFor(() => expect(screen.queryByText('Banca criada')).not.toBeInTheDocument());
    expect(await screen.findByText('Acesso atualizado')).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/platform/audit?limit=20&tenantId=tenant-b',
      { headers: { Authorization: 'Bearer platform-test-token' } },
    );
  });

  it('does not display an old all-tenant response after switching to a specific tenant', async () => {
    let finishFirst!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finishFirst = resolve; });
    mocks.apiRequest.mockImplementation((path: string) => path.includes('tenantId=tenant-b')
      ? Promise.resolve({ events: [bEvent], page: { nextCursor: null, hasMore: false, limit: 20 } })
      : pending);
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar auditoria por banca' }), 'tenant-b');
    expect(await screen.findByText('Acesso atualizado')).toBeInTheDocument();
    finishFirst({ events: [aEvent], page: { nextCursor: null, hasMore: false, limit: 20 } });
    await waitFor(() => expect(screen.queryByText('Banca criada')).not.toBeInTheDocument());
    expect(screen.getByText('Acesso atualizado')).toBeInTheDocument();
  });

  it('shows a retry control after the audit API fails', async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error('Auditoria indisponível'))
      .mockResolvedValue({ events: [], page: { nextCursor: null, hasMore: false, limit: 20 } });
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('Auditoria indisponível');
    await user.click(screen.getByRole('button', { name: 'Atualizar auditoria' }));
    expect(await screen.findByText('Nenhum evento encontrado neste filtro.')).toBeInTheDocument();
  });
});
