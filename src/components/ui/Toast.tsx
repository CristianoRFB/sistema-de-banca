import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { Check, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'info';
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastContextValue = { showToast: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-1), { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div className="toast" key={item.id} role="status">
            {item.tone === 'success' ? <Check size={17} /> : <Info size={17} />}
            <span>{item.message}</span>
            <button type="button" aria-label="Fechar aviso" onClick={() => setItems((current) => current.filter(({ id }) => id !== item.id))}><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast precisa estar dentro de ToastProvider.');
  return context.showToast;
}
