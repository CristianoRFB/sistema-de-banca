import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/routes';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  currentUser: null as { uid: string; getIdToken: () => Promise<string> } | null,
}));

vi.mock('../../src/app/providers', () => ({
  useAdminAuth: () => ({ user: mocks.currentUser, loading: false }),
}));
vi.mock('../../src/infra/browser/api-client', () => ({
  apiRequest: mocks.apiRequest,
}));
vi.mock('../../src/app/layouts/AdminShell', () => ({
  AdminShell: () => <div data-testid="private-admin-panel">Conteúdo administrativo privado</div>,
}));

const userA = { uid: 'uid-a', getIdToken: async () => 'token-a' };
const userB = { uid: 'uid-b', getIdToken: async () => 'token-b' };

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.currentUser = userA;
});

afterEach(() => {
  cleanup();
  mocks.currentUser = null;
});

describe('admin tenant authorization gate', () => {
  it('hides the previous user panel immediately when the Firebase UID changes', async () => {
    let rejectB!: (error: Error) => void;
    const pendingB = new Promise<never>((_resolve, reject) => { rejectB = reject; });
    mocks.apiRequest.mockImplementation((_path: string, init?: RequestInit) => {
      const token = new Headers(init?.headers).get('Authorization');
      return token === 'Bearer token-a'
        ? Promise.resolve({ session: { platformOverride: false, supportExpiresAt: null } })
        : pendingB;
    });

    const view = render(
      <MemoryRouter initialEntries={['/banca-a/painel']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByTestId('private-admin-panel');

    mocks.currentUser = userB;
    view.rerender(
      <MemoryRouter initialEntries={['/banca-a/painel']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('private-admin-panel')).not.toBeInTheDocument();
    expect(screen.getByText('Confirmando acesso à banca…')).toBeInTheDocument();

    rejectB(new Error('membership revoked'));
    await waitFor(() => expect(screen.getByText('Esta conta não pertence a esta banca.')).toBeInTheDocument());
    expect(screen.queryByTestId('private-admin-panel')).not.toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith('/admin/session', {
      headers: { Authorization: 'Bearer token-b' },
    });
  });

  it('refuses invalid public tenant slugs without making a backend request', async () => {
    render(<MemoryRouter initialEntries={['/@invalid']}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Endereço de banca inválido.');
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('refuses invalid admin tenant slugs before checking membership', async () => {
    render(<MemoryRouter initialEntries={['/@invalid/painel']}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Endereço de banca inválido.');
    expect(screen.queryByTestId('private-admin-panel')).not.toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('does not display tenant panel before a user session is verified', async () => {
    mocks.apiRequest.mockRejectedValue(new Error('forbidden'));
    render(
      <MemoryRouter initialEntries={['/banca-a/painel']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByText('Esta conta não pertence a esta banca.');
    expect(screen.queryByTestId('private-admin-panel')).not.toBeInTheDocument();
  });
});
