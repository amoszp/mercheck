import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, SlidersHorizontal } from 'lucide-react';
import { THEMES } from '../lib/settings.js';
import { useDismiss } from '../lib/useDismiss.js';

/**
 * Round glass button next to the dock that opens the display settings:
 * theme (radio cards), quantity visibility (switch) and the account.
 */
export default function SettingsMenu({ settings, onChange, user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="glass flex h-12 w-12 items-center justify-center rounded-full text-fg/80 transition hover:text-fg active:scale-90"
      >
        <SlidersHorizontal size={20} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Settings"
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14 }}
            style={{ transformOrigin: 'bottom right' }}
            className="glass glass-strong absolute bottom-full right-0 z-40 mb-3 w-64 rounded-2xl p-3"
          >
            <p className="px-1 pb-2 text-xs font-medium uppercase tracking-wider text-fg/50">Theme</p>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
              {Object.entries(THEMES).map(([id, theme]) => {
                const selected = settings.theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ theme: id })}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-2 text-sm transition active:scale-95 ${
                      selected ? 'border-accent bg-accent/15 font-semibold' : 'border-fg/10 hover:bg-fg/10'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="h-9 w-full rounded-lg border border-fg/10"
                      style={{ background: theme.swatch }}
                    />
                    {theme.label}
                  </button>
                );
              })}
            </div>

            <p className="px-1 pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-fg/50">Items</p>
            <div className="flex items-center justify-between gap-3 px-1 py-1.5">
              <span id="qty-switch-label" className="text-[15px] text-fg/90">
                Show quantities
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.showQuantity}
                aria-labelledby="qty-switch-label"
                onClick={() => onChange({ showQuantity: !settings.showQuantity })}
                className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
                  settings.showQuantity ? 'border-accent bg-accent' : 'border-fg/15 bg-fg/15'
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    settings.showQuantity ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <p className="px-1 pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-fg/50">Account</p>
            <div className="flex items-center justify-between gap-3 px-1 py-1">
              <span className="min-w-0 truncate text-[15px] text-fg/90">{user.displayName || user.username}</span>
              <button
                type="button"
                onClick={onSignOut}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-fg/10 px-3 py-1.5 text-sm text-fg/80 transition hover:bg-fg/10 active:scale-95"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
