import { useEffect, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';

export function BottomSheet({ open, title, onClose, children }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void }>) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="bottom-sheet__handle" aria-hidden="true" />
        <header className="bottom-sheet__header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="bottom-sheet__content">{children}</div>
      </section>
    </div>
  );
}
