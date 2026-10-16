import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store";
import { answer, queryText, say } from "../src/voice";

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
          { id: "q2", name: "Queso rallado", checked: false },
          { id: "eggs", name: "Huevos", checked: true },
        ],
      },
      { id: "other", name: "ANODESIN", items: [{ id: "food", name: "PIENSO BROWNIE", checked: false }] },
    ],
  });
  return store;
}

const item = (store: Store, list: number, id: string) => store.getState(ME).lists[list].items.find((i) => i.id === id)!;

test("one match: yes marks it", () => {
  const store = seeded();
  assert.match(say(store, ME, "leche"), /^¿Marco "Leche Semi sin lactosa"/);
  assert.match(answer(store, ME, "Sí"), /^Hecho/);
  assert.equal(item(store, 0, "milk").checked, true);
});

test("one match: no changes nothing", () => {
  const store = seeded();
  say(store, ME, "leche");
  assert.equal(answer(store, ME, "no"), "Vale, no cambio nada.");
  assert.equal(item(store, 0, "milk").checked, false);
});

test("several: the list is read out with numbers; a number or a name picks one", () => {
  const store = seeded();
  const q = say(store, ME, "queso");
  assert.match(q, /1: Queso batido \(MERCHEKAO\)\. 2: Queso rallado \(MERCHEKAO\)\. 3: Crear "Queso" en MERCHEKAO\. 4: Crear "Queso" en ANODESIN\./);
  assert.match(answer(store, ME, "el dos"), /^Hecho: "Queso rallado"/);
  assert.equal(item(store, 0, "q2").checked, true);

  say(store, ME, "queso");
  assert.match(answer(store, ME, "batido"), /^Hecho: "Queso batido"/);

  say(store, ME, "queso");
  assert.match(answer(store, ME, "4"), /^Creado "Queso" en ANODESIN/);
});

test("not found: create it in the list named in the answer", () => {
  const store = seeded();
  assert.match(say(store, ME, "arena"), /no está en tus listas/);
  assert.match(answer(store, ME, "Anodesin"), /^Creado "Arena" en ANODESIN/);
});

test("nothing to ask, or an unclear answer, changes nothing", () => {
  const store = seeded();
  assert.match(say(store, ME, "huevos"), /ya está por comprar/);
  assert.equal(answer(store, ME, "vale"), "Vale.");
  say(store, ME, "queso");
  assert.match(answer(store, ME, "mañana"), /no he cambiado nada/);
  assert.equal(item(store, 0, "q1").checked, false);
});

test("query text tolerates double encoding", () => {
  assert.equal(queryText("pasta%20de%20dientes"), "pasta de dientes");
  assert.equal(queryText(42), "");
});

test("several items: existing ones marked, new one in the named list, one answer", () => {
  const store = seeded();
  const q = say(store, ME, "leche, queso batido y arena en Anodesin");
  assert.equal(q, 'Marco "Leche Semi sin lactosa" de MERCHEKAO y "Queso batido" de MERCHEKAO. Creo "Arena" en ANODESIN. ¿Lo hago?');
  assert.equal(answer(store, ME, "sí"), 'Hecho: "Leche Semi sin lactosa" y "Queso batido" por comprar; creado "Arena" en ANODESIN.');
  assert.equal(item(store, 0, "milk").checked, true);
  assert.ok(store.getState(ME).lists[1].items.some((i) => i.name === "Arena" && i.checked));
});

test("several items: new ones without a list are created where the answer says", () => {
  const store = seeded();
  const q = say(store, ME, "leche y arena y pilas");
  assert.match(q, /Creo "Arena" y "Pilas"\. ¿En qué lista creo los nuevos\?/);
  assert.match(answer(store, ME, "en año de sin"), /creados "Arena" en ANODESIN y "Pilas" en ANODESIN/);
  assert.equal(item(store, 0, "milk").checked, true);
});

test("several items: already marked ones are just mentioned; no changes nothing", () => {
  const store = seeded();
  assert.equal(say(store, ME, "huevos y leche"), 'Marco "Leche Semi sin lactosa" de MERCHEKAO. "Huevos" ya estaba por comprar. ¿Lo hago?');
  assert.equal(answer(store, ME, "no"), "Vale, no cambio nada.");
  assert.equal(item(store, 0, "milk").checked, false);
  assert.equal(say(store, ME, "huevos y huevos"), '"Huevos" y "Huevos" ya estaban por comprar.');
});
