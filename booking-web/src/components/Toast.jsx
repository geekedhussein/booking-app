import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const ToastContext = createContext(null);

/**
 * Toasts confirm what an action did, in the same words as the action
 * ("Cancel booking" → "Booking cancelled"). Announced via aria-live.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message, { tone = 'success', duration = 4500 } = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, message, tone }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (m, o) => show(m, { ...o, tone: 'success' }),
      error: (m, o) => show(m, { duration: 7000, ...o, tone: 'error' }),
      info: (m, o) => show(m, { ...o, tone: 'info' }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={18} />
            <span className="toast__msg">{t.message}</span>
            <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
