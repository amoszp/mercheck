import { test } from "node:test";
import assert from "node:assert/strict";
import { OpError, Store } from "../src/store";

const ME = 1;
const OTHER = 2;

function seeded(): Store {
  const store = new Store(":memory:");
  store.importState(ME, {
    lists: [
      {
        id: "l1",
        name: "Shop",
        items: [
          { id: "i1", name: "Milk", checked: true, quantity: 1 },
          { id: "i2", name: "Bread", checked: false, quantity: 2 },
        ],
      },
      { id: "l2", name: "Pets", items: [] },
    ],
  });
  return store;
}

test("import fills an empty account once", () => {
  const store = seeded();
  assert.equal(store.getState(ME).lists.length, 2);
  assert.equal(store.importState(ME, { lists: [{ id: "x", name: "Again", items: [] }] }), false);
  assert.deepEqual(store.getState(ME).lists.map((l) => l.name), ["Shop", "Pets"]);
});

test("import cleans bad input", () => {
  const store = new Store(":memory:");
  store.importState(ME, { lists: [{ id: "l", name: "  ", items: [{ id: "a", name: "Eggs", quantity: 2.6, checked: "no" }] }] });
  const [list] = store.getState(ME).lists;
  assert.equal(list.name, "Untitled");
  assert.deepEqual(list.items[0], { id: "a", name: "Eggs", checked: true, quantity: 3 });
  assert.throws(() => new Store(":memory:").importState(ME, { nope: true }), OpError);
});

test("item operations", () => {
  const store = seeded();
  store.apply(ME, { type: "addItem", listId: "l1", item: { id: "i3", name: "Eggs" } });
  store.apply(ME, { type: "renameItem", listId: "l1", itemId: "i3", name: "Free-range eggs" });
  store.apply(ME, { type: "setItemChecked", listId: "l1", itemId: "i1", checked: false });
  store.apply(ME, { type: "setQuantity", listId: "l1", itemId: "i2", quantity: 5 });
  store.apply(ME, { type: "deleteItem", listId: "l1", itemId: "i2" });
  assert.deepEqual(store.getState(ME).lists[0].items, [
    { id: "i1", name: "Milk", checked: false, quantity: 1 },
    { id: "i3", name: "Free-range eggs", checked: true, quantity: 1 },
  ]);
  store.apply(ME, { type: "restoreItem", listId: "l1", index: 1, item: { id: "i2", name: "Bread", checked: false, quantity: 5 } });
  assert.deepEqual(store.getState(ME).lists[0].items.map((i) => i.id), ["i1", "i2", "i3"]);
});

test("list operations, restart and its undo", () => {
  const store = seeded();
  store.apply(ME, { type: "addList", list: { id: "l3", name: "Trip" } });
  store.apply(ME, { type: "renameList", listId: "l3", name: "Packing" });
  store.apply(ME, { type: "restartList", listId: "l1" });
  assert.ok(store.getState(ME).lists[0].items.every((i) => i.checked));
  store.apply(ME, { type: "setChecked", listId: "l1", checked: { i1: true, i2: false } });
  assert.equal(store.getState(ME).lists[0].items[1].checked, false);

  const removed = store.getState(ME).lists[0];
  store.apply(ME, { type: "deleteList", listId: "l1" });
  assert.deepEqual(store.getState(ME).lists.map((l) => l.name), ["Pets", "Packing"]);
  store.apply(ME, { type: "restoreList", index: 0, list: removed });
  assert.deepEqual(store.getState(ME).lists.map((l) => l.name), ["Shop", "Pets", "Packing"]);
  assert.equal(store.getState(ME).lists[0].items.length, 2);
});

test("another user's lists can't be read or changed", () => {
  const store = seeded();
  assert.deepEqual(store.getState(OTHER).lists, []);
  assert.throws(() => store.apply(OTHER, { type: "deleteList", listId: "l1" }), OpError);
  assert.throws(() => store.apply(OTHER, { type: "addItem", listId: "l1", item: { id: "z", name: "x" } }), OpError);
  assert.throws(() => store.apply(OTHER, { type: "renameItem", listId: "l1", itemId: "i1", name: "x" }), OpError);
  // An item id from one list can't be reached through another list of the same user.
  assert.throws(() => store.apply(ME, { type: "deleteItem", listId: "l2", itemId: "i1" }), OpError);
  assert.throws(() => store.apply(ME, { type: "dropTables" }), OpError);
  assert.equal(store.getState(ME).lists[0].items.length, 2);
});

test("a failed operation changes nothing", () => {
  const store = seeded();
  // The list is inserted, then its duplicate item id fails: the whole thing rolls back.
  assert.throws(
    () => store.apply(ME, { type: "restoreList", index: 0, list: { id: "l9", name: "Dup", items: [{ id: "i1", name: "Milk" }] } }),
    OpError
  );
  assert.deepEqual(store.getState(ME).lists.map((l) => l.id), ["l1", "l2"]);
});
