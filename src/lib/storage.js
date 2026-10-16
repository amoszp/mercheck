import { createId } from './ids.js';

// Lists used to live only in this browser. They are now kept on the server;
// what's still here is read once, at the first sign-in, to import it.
const STORAGE_KEY = 'mercheck-data';
// Key used before the rename to Mercheck.
const LEGACY_STORAGE_KEY = 'mercheck-hub-data';
// Set once an import has happened on this device, so it never runs twice.
const IMPORTED_KEY = 'mercheck-imported';

const cleanText = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const normalizeItem = (raw) => {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const quantity = Number.isFinite(raw.quantity) ? Math.max(1, Math.round(raw.quantity)) : 1;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    name: raw.name.trim(),
    checked: raw.checked !== false,
    quantity,
  };
};

const normalizeList = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    name: cleanText(raw.name, 'Untitled'),
    items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [],
  };
};

// Returns a clean `{ lists }` state, or null when the input is not usable.
export const normalizeState = (raw) => {
  if (!raw || !Array.isArray(raw.lists)) return null;
  return { lists: raw.lists.map(normalizeList).filter(Boolean) };
};

/** Lists saved in this browser that haven't been imported yet, or null. */
export const readLocalLists = () => {
  try {
    if (localStorage.getItem(IMPORTED_KEY)) return null;
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const state = raw ? normalizeState(JSON.parse(raw)) : null;
    return state?.lists.length ? state : null;
  } catch {
    return null;
  }
};

// The old data stays where it was, as a backup; only the flag is added.
export const markImported = () => {
  try {
    localStorage.setItem(IMPORTED_KEY, new Date().toISOString());
  } catch {
    // Storage blocked: the server refuses a second import anyway.
  }
};
