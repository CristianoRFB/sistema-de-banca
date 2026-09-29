import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { BottomSheet } from '../../src/components/ui/BottomSheet';

function Fixture() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Abrir sheet</button>
    {open && <BottomSheet open={open} title="Reservar título" onClose={() => setOpen(false)}>
      <button type="button">Confirmar reserva</button>
    </BottomSheet>}
  </>;
}

afterEach(() => {
  cleanup();
  document.body.querySelector('#root')?.remove();
});

describe('BottomSheet', () => {
  it('move e mantém o foco no diálogo, torna o fundo inerte e restaura o foco ao fechar', async () => {
    const user = userEvent.setup();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    render(<Fixture />, { container: root });
    const opener = screen.getByRole('button', { name: 'Abrir sheet' });

    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Reservar título' });
    const close = screen.getByRole('button', { name: 'Fechar' });
    const confirm = screen.getByRole('button', { name: 'Confirmar reserva' });
    expect(dialog).toHaveFocus();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.inert).toBe(true);

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(root.inert).toBe(false);
    expect(opener).toHaveFocus();
  });
});
