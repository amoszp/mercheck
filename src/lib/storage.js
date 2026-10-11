import { createInitialState } from '../initialData.js';
import { createId } from './ids.js';

export const STORAGE_KEY = 'mercheck-data';
// Key used before the rename; read once so existing lists carry over.
const LEGACY_STORAGE_KEY = 'mercheck-hub-data';

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

export const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return createInitialState();
    return normalizeState(JSON.parse(raw)) ?? createInitialState();
  } catch {
    return createInitialState();
  }
};

export const saveState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode): keep working in memory.
  }
};
