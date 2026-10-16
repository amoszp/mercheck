import { randomUUID } from "node:crypto";
import { OpError, type Store } from "./store";

/**
 * Voice requests from an iPhone Shortcut: "leche", "pienso en Anodesin".
 *
 * `lookup` never changes anything. It answers with a sentence to say and the
 * possible actions, each one a flat `option` string the shortcut sends back to
 * `apply` once the user has confirmed (one option) or picked one (several).
 * No options means there is nothing to do; the sentence says why.
 * `menu` holds the same options as label → option, the shape a shortcut's
 * "Choose from List" can show directly and look the choice up in.
 */

export interface SiriOption {
  label: string;
  option: string;
}

export interface SiriAnswer {
  speak: string;
  options: SiriOption[];
  menu: Record<string, string>;
}

const MAX_MATCHES = 6;

// Words people put in front of the item: "añade leche", "hay que comprar pan".
const LEADING_FILLERS = [
  "hay que comprar",
  "me falta",
  "nos falta",
  "me faltan",
  "nos faltan",
  "anade",
  "anadir",
  "apunta",
  "apuntar",
  "pon",
  "poner",
  "marca",
  "marcar",
  "compra",
  "comprar",
  "necesito",
  "falta",
  "faltan",
  "quiero",
];
const ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del"]);
// "... en Anodesin", "... a la lista Merchekao".
const LIST_MARKERS = [["en", "la", "lista"], ["a", "la", "lista"], ["en"], ["a"], ["para"]];

/** Lowercase, no accents (ñ → n), only letters and digits. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Looser key for names Siri may spell differently: no spaces, no h, k → c, v → b. */
export function loose(text: string): string {
  return normalize(text).replace(/\s+/g, "").replace(/h/g, "").replace(/k/g, "c").replace(/v/g, "b");
}

const words = (text: string) => normalize(text).split(" ").filter(Boolean);

function sameWord(query: string, word: string): boolean {
  if (word.startsWith(query)) return true;
  // "papas" should find "Papa": try the query without a plural ending.
  if (query.length >= 4 && query.endsWith("es") && word.startsWith(query.slice(0, -2))) return true;
  return query.length >= 4 && query.endsWith("s") && word.startsWith(query.slice(0, -1));
}

/** 0 = no match; higher is closer. */
export function score(query: string, itemName: string): number {
  const q = normalize(query);
  const name = normalize(itemName);
  if (!q) return 0;
  if (q === name || loose(q) === loose(name)) return 100;
  if (` ${name} `.includes(` ${q} `)) return 80;
  const itemWords = name.split(" ");
  if (q.split(" ").every((w) => itemWords.some((iw) => sameWord(w, iw)))) return 60;
  return 0;
}

interface Parsed {
  /** The item as the user said it, original spelling, fillers removed. */
  name: string;
  listId: string | null;
}

export function parse(text: string, lists: { id: string; name: string }[]): Parsed {
  let tokens = text.trim().split(/\s+/).filter(Boolean);
  const norm = () => tokens.map((t) => normalize(t));

  // Leading fillers and articles: "añade la leche" → "leche".
  let stripped = true;
  while (stripped && tokens.length > 1) {
    stripped = false;
    const n = norm();
    for (const filler of LEADING_FILLERS) {
      const parts = filler.split(" ");
      if (parts.every((p, i) => n[i] === p) && tokens.length > parts.length) {
        tokens = tokens.slice(parts.length);
        stripped = true;
        break;
      }
    }
    if (!stripped && ARTICLES.has(norm()[0]) && tokens.length > 1) {
      tokens = tokens.slice(1);
      stripped = true;
    }
  }

  // Trailing list name: "pienso en Anodesin".
  let listId: string | null = null;
  const n = norm();
  for (let cut = 1; cut < tokens.length && !listId; cut++) {
    const tail = n.slice(cut);
    for (const marker of LIST_MARKERS) {
      if (!marker.every((m, i) => tail[i] === m) || tail.length <= marker.length) continue;
      const spoken = tail.slice(marker.length).join(" ");
      const list = lists.find((l) => loose(l.name) === loose(spoken));
      if (list) {
        listId = list.id;
        tokens = tokens.slice(0, cut);
        break;
      }
    }
  }

  const name = tokens.join(" ").replace(/[.,;:!?¿¡]+$/g, "").trim();
  return { name: name.charAt(0).toUpperCase() + name.slice(1), listId };
}

function answer(speak: string, options: SiriOption[] = []): SiriAnswer {
  const menu: Record<string, string> = {};
  for (const { label, option } of options) {
    // Labels are the keys, so two identical ones get a number.
    let key = label;
    for (let n = 2; key in menu; n++) key = `${label} ${n}`;
    menu[key] = option;
  }
  return { speak, options, menu };
}

export function lookup(store: Store, userId: number, text: string): SiriAnswer {
  const state = store.getState(userId);
  if (state.lists.length === 0) return answer("No tienes ninguna lista en Mercheck.");

  const { name, listId } = parse(text, state.lists);
  if (!normalize(name)) return answer("No he entendido qué quieres apuntar.");

  const lists = listId ? state.lists.filter((l) => l.id === listId) : state.lists;
  const scored = lists
    .flatMap((list) => list.items.map((item) => ({ list, item, score: score(name, item.name) })))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored.length ? scored[0].score : 0;
  // An exact name wins outright; otherwise every partial match is a candidate.
  const matches = (best === 100 ? scored.filter((m) => m.score === 100) : scored).slice(0, MAX_MATCHES);

  const createOptions = lists.map((list) => ({
    label: lists.length === 1 ? `Crear "${name}" nuevo` : `Crear "${name}" en ${list.name}`,
    option: `create:${list.id}:${name}`,
  }));

  if (matches.length === 0) {
    if (lists.length === 1) {
      return answer(`"${name}" no está en ${lists[0].name}. ¿Lo creo?`, createOptions);
    }
    return answer(`"${name}" no está en tus listas. ¿En qué lista lo creo?`, createOptions);
  }

  if (matches.length === 1) {
    const { list, item } = matches[0];
    if (item.checked) return answer(`"${item.name}" ya está por comprar en ${list.name}.`);
    return answer(`¿Marco "${item.name}" de ${list.name} como por comprar?`, [
      { label: `${item.name} (${list.name})`, option: `mark:${list.id}:${item.id}` },
    ]);
  }

  return answer(`Hay ${matches.length} parecidos. ¿Cuál es?`, [
    ...matches.map(({ list, item }) => ({
      label: `${item.name} (${list.name})${item.checked ? " · ya por comprar" : ""}`,
      option: `mark:${list.id}:${item.id}`,
    })),
    ...createOptions,
  ]);
}

export function apply(store: Store, userId: number, option: string): { speak: string } {
  if (typeof option !== "string") throw new OpError("option is required");
  const [kind, listId, ...rest] = option.split(":");
  const value = rest.join(":");
  const list = store.getState(userId).lists.find((l) => l.id === listId);
  if (!list) throw new OpError("list not found");

  if (kind === "mark") {
    const item = list.items.find((i) => i.id === value);
    if (!item) throw new OpError("item not found");
    if (item.checked) return { speak: `"${item.name}" ya estaba por comprar.` };
    store.apply(userId, { type: "setItemChecked", listId, itemId: item.id, checked: true });
    return { speak: `Hecho: "${item.name}" por comprar en ${list.name}.` };
  }

  if (kind === "create") {
    const name = value.trim();
    if (!name) throw new OpError("name is required");
    // Created in the meantime (or said twice): mark that one instead of a duplicate.
    const existing = list.items.find((i) => normalize(i.name) === normalize(name));
    if (existing) return apply(store, userId, `mark:${listId}:${existing.id}`);
    store.apply(userId, { type: "addItem", listId, item: { id: randomUUID(), name, checked: true, quantity: 1 } });
    return { speak: `Creado "${name}" en ${list.name}, por comprar.` };
  }

  throw new OpError("unknown option");
}
