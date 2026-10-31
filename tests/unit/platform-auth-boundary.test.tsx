import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/routes';

const mocks = vi.hoisted(() => ({
  currentUser: { uid: 'owner-a' } as { uid: string } | null,
}));

vi.mock('../../src/app/providers', () => ({
  useAdminAuth: () => ({ user: mocks.currentUser, loading: false, configured: true }),
}));
vi.mock('../../src/pages/platform/PlatformAdminPage', () => ({
  PlatformAdminPage: () => {
    const [counter, setCounter] = useState(0);
    return <button type="button" onClick={() => setCounter((value) => value + 1)}>
      Console global: {counter}
    </button>;
  },
}));

beforeEach(() => { mocks.currentUser = { uid: 'owner-a' }; });
afterEach(() => { cleanup(); });

describe('platform owner authentication boundary', () => {
  it('unmounts the old owner console and resets state when the Firebase UID changes', async () => {
    const app = () => <MemoryRouter initialEntries={['/admin']}><AppRoutes /></MemoryRouter>;
    const view = render(app());
    const button = await screen.findByRole('button', { name: 'Console global: 0' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Console global: 1' })).toBeInTheDocument();

    mocks.currentUser = { uid: 'owner-b' };
    view.rerender(app());
    expect(await screen.findByRole('button', { name: 'Console global: 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Console global: 1' })).not.toBeInTheDocument();
  });
});
