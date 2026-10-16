import { apply, lookup, normalize, type SiriOption } from "./siri";
import type { Store } from "./store";

/**
 * Two-step voice conversation for a minimal iPhone Shortcut:
 *   1. `say(text)` looks the item up and asks: yes/no for one option, a
 *      numbered list for several;
 *   2. `answer(text)` takes "sí", "no", a number ("el dos") or part of a
 *      choice's name, and does it.
 * The open question is kept per user for a few minutes.
 */

const PENDING_MS = 10 * 60_000;
const pending = new Map<number, { options: SiriOption[]; until: number }>();

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

export function say(store: Store, userId: number, text: string): string {
  pending.delete(userId);
  const found = lookup(store, userId, text);
  if (found.options.length === 0) return found.speak;
  pending.set(userId, { options: found.options, until: Date.now() + PENDING_MS });
  if (found.options.length === 1) return found.speak;
  const list = found.options.map((o, i) => `${i + 1}: ${o.label}.`).join(" ");
  return `${found.speak} ${list}`;
}

export function answer(store: Store, userId: number, text: string): string {
  const entry = pending.get(userId);
  pending.delete(userId);
  if (!entry || entry.until <= Date.now()) return "Vale.";
  const { options } = entry;
  const said = normalize(text);

  if (NO.test(said)) return "Vale, no cambio nada.";
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
