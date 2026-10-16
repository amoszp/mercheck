import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store";
import { apply, lookup, parse } from "../src/siri";

const ME = 1;

function seeded(): Store {
  const store = new Store(":memory:");
  store.importState(ME, {
    lists: [
      {
        id: "super",
        name: "MERCHEKAO",
        items: [
          { id: "milk", name: "Leche Semi sin lactosa", checked: false },
          { id: "q1", name: "Queso batido", checked: false },
          { id: "q2", name: "Queso rallado", checked: true },
          { id: "q3", name: "Queso blanco en triángulos", checked: false },
          { id: "banana", name: "Plátanos", checked: false },
          { id: "eggs", name: "Huevos", checked: true },
        ],
      },
      { id: "other", name: "ANODESIN", items: [{ id: "food", name: "PIENSO BROWNIE", checked: false }] },
    ],
  });
  return store;
}

const lists = [
  { id: "super", name: "MERCHEKAO" },
  { id: "other", name: "ANODESIN" },
];

test("parse strips fillers and a trailing list name", () => {
  assert.deepEqual(parse("añade la leche", lists), { name: "Leche", listId: null });
  assert.deepEqual(parse("hay que comprar pan", lists), { name: "Pan", listId: null });
  assert.deepEqual(parse("pienso en Anodesin", lists), { name: "Pienso", listId: "other" });
  // Siri may write the list name the way it sounds.
  assert.deepEqual(parse("arena en año de sin", lists), { name: "Arena", listId: "other" });
  assert.deepEqual(parse("pan a la lista merchecao", lists), { name: "Pan", listId: "super" });
  // "en" followed by something that isn't a list stays part of the item.
  assert.deepEqual(parse("leche en polvo", lists), { name: "Leche en polvo", listId: null });
});

test("one match: confirm, then mark", () => {
  const store = seeded();
  const answer = lookup(store, ME, "leche");
  assert.equal(answer.options.length, 1);
  assert.match(answer.speak, /Leche Semi sin lactosa/);
  assert.match(apply(store, ME, answer.options[0].option).speak, /^Hecho/);
  assert.equal(store.getState(ME).lists[0].items[0].checked, true);
});

test("plurals and accents still match", () => {
  const store = seeded();
  assert.match(lookup(store, ME, "platano").speak, /Plátanos/);
  assert.match(lookup(store, ME, "pienso").speak, /PIENSO BROWNIE/);
});

test("already to buy: nothing to do", () => {
  const answer = lookup(seeded(), ME, "huevos");
  assert.deepEqual(answer.options, []);
  assert.match(answer.speak, /ya está por comprar/);
});

test("several matches: a menu that ends with create options", () => {
  const answer = lookup(seeded(), ME, "queso");
  const labels = answer.options.map((o) => o.label);
  assert.equal(labels.length, 3 + 2);
  assert.ok(labels.some((l) => l.includes("Queso rallado") && l.includes("ya por comprar")));
  assert.deepEqual(labels.slice(-2), ['Crear "Queso" en MERCHEKAO', 'Crear "Queso" en ANODESIN']);
});

test("an exact name beats partial matches", () => {
  const store = seeded();
  store.apply(ME, { type: "addItem", listId: "super", item: { id: "q0", name: "Queso", checked: false } });
  const answer = lookup(store, ME, "queso");
  assert.equal(answer.options.length, 1);
  assert.equal(answer.options[0].option, "mark:super:q0");
});

test("no match: ask which list, then create it to buy", () => {
  const store = seeded();
  const answer = lookup(store, ME, "papel de cocina");
  assert.match(answer.speak, /¿En qué lista/);
  assert.equal(answer.options.length, 2);
  assert.match(apply(store, ME, answer.options[0].option).speak, /^Creado "Papel de cocina" en MERCHEKAO/);
  const created = store.getState(ME).lists[0].items.at(-1)!;
  assert.equal(created.name, "Papel de cocina");
  assert.equal(created.checked, true);
});

test("a named list narrows the search and the create option", () => {
  const answer = lookup(seeded(), ME, "arena en anodesin");
  assert.deepEqual(answer.options.map((o) => o.option), ["create:other:Arena"]);
  assert.match(answer.speak, /¿Lo creo\?/);
});

test("creating something that now exists marks it instead", () => {
  const store = seeded();
  assert.match(apply(store, ME, "create:super:leche semi sin lactosa").speak, /^Hecho/);
  assert.equal(store.getState(ME).lists[0].items.length, 6);
});

test("options can't reach another user's lists", () => {
  const store = seeded();
  assert.throws(() => apply(store, 2, "mark:super:milk"));
  assert.match(lookup(store, 2, "leche").speak, /No tienes ninguna lista/);
});

test("menu maps each label to its option", () => {
  const store = seeded();
  const answer = lookup(store, ME, "queso");
  assert.ok(answer.options.length > 1);
  assert.deepEqual(answer.menu, Object.fromEntries(answer.options.map((o) => [o.label, o.option])));
  assert.deepEqual(lookup(store, ME, "huevos").menu, {});
});
