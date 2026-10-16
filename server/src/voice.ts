import { apply, lookup, loose, normalize, parse, score, type SiriOption } from "./siri";
import type { List, Store } from "./store";

/**
 * Two-step voice conversation for a minimal iPhone Shortcut:
 *   1. `say(text)` looks the item up and asks: yes/no for one option, a
 *      numbered list for several;
 *   2. `answer(text)` takes "sí", "no", a number ("el dos") or part of a
 *      choice's name, and does it.
 * Several items in one sentence ("leche, pan y arena en Anodesin") are
 * handled together: one read-back of the whole plan, one answer.
 * The open question is kept per user for a few minutes.
 */

const PENDING_MS = 10 * 60_000;
interface Batch {
  /** Existing items to mark as "to buy". */
  marks: { listId: string; itemId: string }[];
  /** New items, and the list they go in (null: the answer names it). */
  creates: { name: string; listId: string | null }[];
}
type Open = { options: SiriOption[] } | { batch: Batch };
const pending = new Map<number, { open: Open; until: number }>();

const YES = /^(si|sip|vale|ok|okay|claro|dale|venga|correcto|perfecto|hazlo|de acuerdo|yes|afirmativo|por favor)\b/;
const NO = /^(no|nop|nada|ninguno|ninguna|cancela|cancelar|dejalo|olvidalo)\b/;
const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, primero: 1, primera: 1,
  dos: 2, segundo: 2, segunda: 2,
  tres: 3, tercero: 3, tercera: 3,
  cuatro: 4, cuarto: 4, cuarta: 4,
  cinco: 5, quinto: 5, quinta: 5,
  seis: 6, sexto: 6, sexta: 6,
  siete: 7, septimo: 7, septima: 7,
  ocho: 8, octavo: 8, octava: 8,
  nueve: 9, noveno: 9, novena: 9,
  diez: 10, decimo: 10, decima: 10,
};

/** "el dos", "la segunda", "3", "número 4" → that number; otherwise null. */
function spokenNumber(text: string): number | null {
  const words = normalize(text).split(" ").filter((w) => !["el", "la", "numero", "opcion"].includes(w));
  if (words.length !== 1) return null;
  if (/^\d{1,2}$/.test(words[0])) return Number(words[0]);
  return NUMBER_WORDS[words[0]] ?? null;
}

/** "a", "a y b", "a, b y c". */
function joinEs(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** "leche, pan y arena en Anodesin" → its pieces; "y" inside a single name is rare enough. */
function splitItems(text: string): string[] {
  return text
    .split(/\s*,\s*|\s+y\s+|\s+e\s+/i)
    .map((t) => t.trim())
    .filter((t) => normalize(t));
}

function sayBatch(store: Store, userId: number, pieces: string[]): string {
  const lists = store.getState(userId).lists;
  if (lists.length === 0) return "No tienes ninguna lista en Mercheck.";
  const batch: Batch = { marks: [], creates: [] };
  const toMark: string[] = [];
  const already: string[] = [];
  const toCreate: string[] = [];

  for (const piece of pieces) {
    const { name, listId } = parse(piece, lists);
    if (!normalize(name)) continue;
    const scope: List[] = listId ? lists.filter((l) => l.id === listId) : lists;
    // The closest match wins; ties go to the first list.
    let best: { list: List; item: List["items"][number]; score: number } | null = null;
    for (const list of scope) {
      for (const item of list.items) {
        const sc = score(name, item.name);
        if (sc > 0 && (!best || sc > best.score)) best = { list, item, score: sc };
      }
    }
    if (best) {
      if (best.item.checked) already.push(`"${best.item.name}"`);
      else if (!batch.marks.some((m) => m.itemId === best!.item.id)) {
        batch.marks.push({ listId: best.list.id, itemId: best.item.id });
        toMark.push(`"${best.item.name}" de ${best.list.name}`);
      }
      continue;
    }
    const into = scope.length === 1 ? scope[0] : null;
    batch.creates.push({ name, listId: into?.id ?? null });
    toCreate.push(into ? `"${name}" en ${into.name}` : `"${name}"`);
  }

  const sentences: string[] = [];
  if (toMark.length) sentences.push(`Marco ${joinEs(toMark)}.`);
  if (toCreate.length) sentences.push(`Creo ${joinEs(toCreate)}.`);
  if (already.length) sentences.push(`${joinEs(already)} ya ${already.length === 1 ? "estaba" : "estaban"} por comprar.`);
  if (!batch.marks.length && !batch.creates.length) return sentences.join(" ") || "No he entendido qué quieres apuntar.";

  pending.set(userId, { open: { batch }, until: Date.now() + PENDING_MS });
  const needList = batch.creates.filter((c) => !c.listId).length;
  if (needList) {
    sentences.push(`¿En qué lista ${needList === 1 ? "creo el nuevo" : "creo los nuevos"}? Di el nombre de la lista, o "no".`);
  } else {
    sentences.push("¿Lo hago?");
  }
  return sentences.join(" ");
}

function runBatch(store: Store, userId: number, batch: Batch, listForNew: List | null): string {
  const lists = store.getState(userId).lists;
  const marked: string[] = [];
  const created: string[] = [];
  for (const m of batch.marks) {
    const item = lists.find((l) => l.id === m.listId)?.items.find((i) => i.id === m.itemId);
    if (!item) continue;
    apply(store, userId, `mark:${m.listId}:${m.itemId}`);
    marked.push(`"${item.name}"`);
  }
  for (const c of batch.creates) {
    const listId = c.listId ?? listForNew?.id;
    const list = lists.find((l) => l.id === listId);
    if (!list) continue;
    apply(store, userId, `create:${list.id}:${c.name}`);
    created.push(`"${c.name}" en ${list.name}`);
  }
  const parts: string[] = [];
  if (marked.length) parts.push(`${joinEs(marked)} por comprar`);
  if (created.length) parts.push(`${created.length === 1 ? "creado" : "creados"} ${joinEs(created)}`);
  return parts.length ? `Hecho: ${parts.join("; ")}.` : "No he cambiado nada.";
}

export function say(store: Store, userId: number, text: string): string {
  pending.delete(userId);
  const pieces = splitItems(text);
  if (pieces.length > 1) return sayBatch(store, userId, pieces);
  const found = lookup(store, userId, text);
  if (found.options.length === 0) return found.speak;
  pending.set(userId, { open: { options: found.options }, until: Date.now() + PENDING_MS });
  if (found.options.length === 1) return found.speak;
  const list = found.options.map((o, i) => `${i + 1}: ${o.label}.`).join(" ");
  return `${found.speak} ${list}`;
}

export function answer(store: Store, userId: number, text: string): string {
  const entry = pending.get(userId);
  pending.delete(userId);
  if (!entry || entry.until <= Date.now()) return "Vale.";
  const said = normalize(text);
  if (NO.test(said)) return "Vale, no cambio nada.";

  if ("batch" in entry.open) {
    const { batch } = entry.open;
    if (batch.creates.some((c) => !c.listId)) {
      // The answer names the list for the new items.
      const lists = store.getState(userId).lists;
      const list = lists.find((l) => loose(said).includes(loose(l.name))) ?? null;
      if (!list) return "No he reconocido esa lista, así que no he cambiado nada.";
      return runBatch(store, userId, batch, list);
    }
    return YES.test(said) ? runBatch(store, userId, batch, null) : "No lo he entendido, así que no he cambiado nada.";
  }

  const { options } = entry.open;
  if (options.length === 1 && (YES.test(said) || spokenNumber(text) === 1)) return apply(store, userId, options[0].option).speak;

  const n = spokenNumber(text);
  if (n !== null && n >= 1 && n <= options.length) return apply(store, userId, options[n - 1].option).speak;

  // Part of a choice's name: "batido", "Anodesin".
  const words = said.split(" ").filter((w) => w.length > 1);
  if (words.length) {
    const hits = options.filter((o) => {
      const label = normalize(o.label);
      return words.every((w) => label.includes(w));
    });
    if (hits.length === 1) return apply(store, userId, hits[0].option).speak;
  }
  return "No lo he entendido, así que no he cambiado nada.";
}

/** Query text from a shortcut, which may arrive encoded once more than needed. */
export function queryText(value: unknown): string {
  let text = typeof value === "string" ? value : "";
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(text); i++) {
    try {
      text = decodeURIComponent(text);
    } catch {
      break;
    }
  }
  return text.trim().slice(0, 300);
}
