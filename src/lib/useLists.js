import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { createId } from './ids.js';

const insertAt = (array, index, value) => {
  const next = [...array];
  next.splice(Math.min(index, next.length), 0, value);
  return next;
};

const mapList = (state, listId, fn) => ({
  ...state,
  lists: state.lists.map((list) => (list.id === listId ? fn(list) : list)),
});

const mapItem = (state, listId, itemId, fn) =>
  mapList(state, listId, (list) => ({
    ...list,
    items: list.items.map((item) => (item.id === itemId ? fn(item) : item)),
  }));

const findItem = (state, listId, itemId) =>
  state.lists.find((l) => l.id === listId)?.items.find((item) => item.id === itemId);

/**
 * Owns the lists plus a single-slot toast. Every change shows at once and is
 * sent to the server as one operation; operations go out one at a time, in
 * order, and the server's answer replaces the local copy once nothing else is
 * waiting. Reopening the app reloads from the server, so changes made
 * elsewhere (another device, Siri) show up.
 *
 * A toast carrying `restore` (a pure `(state) => state`) and `undoOp` is an
 * undo offer for a destructive action.
 */
export function useLists(initialState, onSignedOut) {
  const [data, setData] = useState(initialState);
  const [toast, setToast] = useState(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const queue = useRef(Promise.resolve());
  const pending = useRef(0);

  const failed = useCallback(
    (err) => {
      if (err.status === 401) {
        onSignedOut();
        return;
      }
      setToast({
        id: createId(),
        message: err.status === 0 ? 'Offline: change not saved' : 'Couldn’t save that change',
      });
    },
    [onSignedOut],
  );

  const reload = useCallback(() => {
    queue.current = queue.current
      .then(() => api.get('/api/state'))
      .then((state) => {
        if (pending.current === 0) setData(state);
      })
      .catch((err) => {
        if (err.status === 401) onSignedOut();
      });
  }, [onSignedOut]);

  const send = useCallback(
    (op) => {
      pending.current += 1;
      queue.current = queue.current
        .then(() => api.post('/api/ops', op))
        .then(
          (state) => {
            pending.current -= 1;
            if (pending.current === 0) setData(state);
          },
          (err) => {
            pending.current -= 1;
            failed(err);
            // Show what the server really has instead of the unsaved change.
            reload();
          },
        );
    },
    [failed, reload],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const offerUndo = useCallback((message, restore, undoOp) => {
    setToast({ id: createId(), message, restore, undoOp });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const runUndo = useCallback(() => {
    if (!toast?.restore) return;
    setData(toast.restore);
    send(toast.undoOp);
    setToast(null);
  }, [toast, send]);

  const addList = useCallback(() => {
    const id = createId();
    const name = 'New List';
    setData((prev) => ({ ...prev, lists: [...prev.lists, { id, name, items: [] }] }));
    send({ type: 'addList', list: { id, name } });
    return id;
  }, [send]);

  const renameList = useCallback(
    (listId, name) => {
      const clean = name.trim() || 'Untitled';
      setData((prev) => mapList(prev, listId, (list) => ({ ...list, name: clean })));
      send({ type: 'renameList', listId, name: clean });
    },
    [send],
  );

  const deleteList = useCallback(
    (listId) => {
      const index = dataRef.current.lists.findIndex((list) => list.id === listId);
      if (index === -1) return;
      const removed = dataRef.current.lists[index];
      setData((prev) => ({ ...prev, lists: prev.lists.filter((list) => list.id !== listId) }));
      send({ type: 'deleteList', listId });
      offerUndo(
        `Deleted “${removed.name}”`,
        (state) => ({ ...state, lists: insertAt(state.lists, index, removed) }),
        { type: 'restoreList', list: removed, index },
      );
    },
    [send, offerUndo],
  );

  // Marks every item as "to buy" again, ready for the next shopping trip.
  const restartList = useCallback(
    (listId) => {
      const list = dataRef.current.lists.find((l) => l.id === listId);
      if (!list) return;
      const previous = new Map(list.items.map((item) => [item.id, item.checked]));
      setData((prev) =>
        mapList(prev, listId, (l) => ({
          ...l,
          items: l.items.map((item) => ({ ...item, checked: true })),
        })),
      );
      send({ type: 'restartList', listId });
      offerUndo(
        `Restarted “${list.name}”`,
        (state) =>
          mapList(state, listId, (l) => ({
            ...l,
            items: l.items.map((item) => ({ ...item, checked: previous.get(item.id) ?? item.checked })),
          })),
        { type: 'setChecked', listId, checked: Object.fromEntries(previous) },
      );
    },
    [send, offerUndo],
  );

  const addItem = useCallback(
    (listId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const item = { id: createId(), name: trimmed, checked: true, quantity: 1 };
      setData((prev) => mapList(prev, listId, (list) => ({ ...list, items: [...list.items, item] })));
      send({ type: 'addItem', listId, item });
    },
    [send],
  );

  const renameItem = useCallback(
    (listId, itemId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setData((prev) => mapItem(prev, listId, itemId, (item) => ({ ...item, name: trimmed })));
      send({ type: 'renameItem', listId, itemId, name: trimmed });
    },
    [send],
  );

  const toggleItem = useCallback(
    (listId, itemId) => {
      const item = findItem(dataRef.current, listId, itemId);
      if (!item) return;
      const checked = !item.checked;
      setData((prev) => mapItem(prev, listId, itemId, (i) => ({ ...i, checked })));
      send({ type: 'setItemChecked', listId, itemId, checked });
    },
    [send],
  );

  const changeQuantity = useCallback(
    (listId, itemId, delta) => {
      const item = findItem(dataRef.current, listId, itemId);
      if (!item) return;
      const quantity = Math.max(1, item.quantity + delta);
      setData((prev) => mapItem(prev, listId, itemId, (i) => ({ ...i, quantity })));
      send({ type: 'setQuantity', listId, itemId, quantity });
    },
    [send],
  );

  const deleteItem = useCallback(
    (listId, itemId) => {
      const list = dataRef.current.lists.find((l) => l.id === listId);
      const index = list?.items.findIndex((item) => item.id === itemId) ?? -1;
      if (index === -1) return;
      const removed = list.items[index];
      setData((prev) =>
        mapList(prev, listId, (l) => ({ ...l, items: l.items.filter((item) => item.id !== itemId) })),
      );
      send({ type: 'deleteItem', listId, itemId });
      offerUndo(
        `Removed “${removed.name}”`,
        (state) =>
          state.lists.some((l) => l.id === listId)
            ? mapList(state, listId, (l) => ({ ...l, items: insertAt(l.items, index, removed) }))
            : state,
        { type: 'restoreItem', listId, item: removed, index },
      );
    },
    [send, offerUndo],
  );

  return {
    data,
    toast,
    dismissToast,
    runUndo,
    addList,
    renameList,
    deleteList,
    restartList,
    addItem,
    renameItem,
    toggleItem,
    changeQuantity,
    deleteItem,
  };
}
