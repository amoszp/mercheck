import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Item {
  id: string;
  name: string;
  /** true = still to buy (same meaning as in the app). */
  checked: boolean;
  quantity: number;
}

export interface List {
  id: string;
  name: string;
  items: Item[];
}

export interface State {
  lists: List[];
}

/** Thrown for a request that can't be applied (bad shape, unknown id, ...). */
export class OpError extends Error {}

const MAX_NAME = 200;
const MAX_ID = 64;
const MAX_QUANTITY = 999;

// ---------- input cleaning ----------

function cleanName(value: unknown, fallback?: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, MAX_NAME) : "";
  if (name) return name;
  if (fallback !== undefined) return fallback;
  throw new OpError("name is required");
}

function cleanId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > MAX_ID) throw new OpError("invalid id");
  return value;
}

function cleanQuantity(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(MAX_QUANTITY, Math.max(1, Math.round(n))) : 1;
}

function cleanIndex(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : Number.MAX_SAFE_INTEGER;
}

function cleanItem(raw: any): Item {
  return {
    id: cleanId(raw?.id),
    name: cleanName(raw?.name),
    checked: raw?.checked !== false,
    quantity: cleanQuantity(raw?.quantity ?? 1),
  };
}

function cleanList(raw: any): List {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return { id: cleanId(raw?.id), name: cleanName(raw?.name, "Untitled"), items: items.map(cleanItem) };
}

// ---------- store ----------

/**
 * Lists and items per user (a user id from the accounts service). Ids are
 * created by the app, so an operation and its undo can name the same rows.
 */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lists_user ON lists(user_id, position);
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        checked INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS items_list ON items(list_id, position);
    `);
  }

  getState(userId: number): State {
    const lists = this.db
      .prepare("SELECT id, name FROM lists WHERE user_id = ? ORDER BY position, created_at")
      .all(userId) as { id: string; name: string }[];
    const itemsStmt = this.db.prepare(
      "SELECT id, name, checked, quantity FROM items WHERE list_id = ? ORDER BY position"
    );
    return {
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        items: (itemsStmt.all(list.id) as any[]).map((row) => ({
          id: row.id,
          name: row.name,
          checked: row.checked === 1,
          quantity: row.quantity,
        })),
      })),
    };
  }

  /** Copies lists kept in a browser into an account that has none yet. */
  importState(userId: number, raw: unknown): boolean {
    if (this.countLists(userId) > 0) return false;
    const lists = Array.isArray((raw as any)?.lists) ? (raw as any).lists.map(cleanList) : null;
    if (!lists) throw new OpError("lists are required");
    this.transaction(() => {
      lists.forEach((list: List) => this.insertList(userId, list, Number.MAX_SAFE_INTEGER));
    });
    return true;
  }

  /** Applies one change made in the app. Each kind mirrors one action there. */
  apply(userId: number, op: any): void {
    const type = op?.type;
    this.transaction(() => {
      switch (type) {
        case "addList":
          this.insertList(userId, { ...cleanList(op.list), items: [] }, Number.MAX_SAFE_INTEGER);
          break;
        case "restoreList":
          this.insertList(userId, cleanList(op.list), cleanIndex(op.index));
          break;
        case "renameList":
          this.ownList(userId, op.listId);
          this.db.prepare("UPDATE lists SET name = ? WHERE id = ?").run(cleanName(op.name, "Untitled"), op.listId);
          break;
        case "deleteList":
          this.ownList(userId, op.listId);
          this.db.prepare("DELETE FROM lists WHERE id = ?").run(op.listId);
          this.renumber("lists", "user_id", userId);
          break;
        case "restartList":
          this.ownList(userId, op.listId);
          this.db.prepare("UPDATE items SET checked = 1 WHERE list_id = ?").run(op.listId);
          break;
        case "setChecked": {
          // Undo of a restart: puts back each item's previous state.
          this.ownList(userId, op.listId);
          const stmt = this.db.prepare("UPDATE items SET checked = ? WHERE id = ? AND list_id = ?");
          for (const [itemId, checked] of Object.entries(op.checked ?? {})) {
            stmt.run(checked === false ? 0 : 1, itemId, op.listId);
          }
          break;
        }
        case "addItem":
          this.ownList(userId, op.listId);
          this.insertItem(op.listId, cleanItem(op.item), Number.MAX_SAFE_INTEGER);
          break;
        case "restoreItem":
          this.ownList(userId, op.listId);
          this.insertItem(op.listId, cleanItem(op.item), cleanIndex(op.index));
          break;
        case "renameItem":
          this.ownItem(userId, op.listId, op.itemId);
          this.db.prepare("UPDATE items SET name = ? WHERE id = ?").run(cleanName(op.name), op.itemId);
          break;
        case "setItemChecked":
          this.ownItem(userId, op.listId, op.itemId);
          this.db.prepare("UPDATE items SET checked = ? WHERE id = ?").run(op.checked === false ? 0 : 1, op.itemId);
          break;
        case "setQuantity":
          this.ownItem(userId, op.listId, op.itemId);
          this.db.prepare("UPDATE items SET quantity = ? WHERE id = ?").run(cleanQuantity(op.quantity), op.itemId);
          break;
        case "deleteItem":
          this.ownItem(userId, op.listId, op.itemId);
          this.db.prepare("DELETE FROM items WHERE id = ?").run(op.itemId);
          this.renumber("items", "list_id", op.listId);
          break;
        default:
          throw new OpError("unknown operation");
      }
    });
  }

  close(): void {
    this.db.close();
  }

  // ---------- helpers ----------

  private countLists(userId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM lists WHERE user_id = ?").get(userId) as any).n;
  }

  private ownList(userId: number, listId: unknown): void {
    const row = this.db.prepare("SELECT user_id FROM lists WHERE id = ?").get(cleanId(listId)) as any;
    if (!row || row.user_id !== userId) throw new OpError("list not found");
  }

  private ownItem(userId: number, listId: unknown, itemId: unknown): void {
    this.ownList(userId, listId);
    const row = this.db.prepare("SELECT list_id FROM items WHERE id = ?").get(cleanId(itemId)) as any;
    if (!row || row.list_id !== listId) throw new OpError("item not found");
  }

  private insertList(userId: number, list: List, index: number): void {
    if (this.db.prepare("SELECT 1 FROM lists WHERE id = ?").get(list.id)) throw new OpError("list already exists");
    const position = this.openSlot("lists", "user_id", userId, index);
    this.db
      .prepare("INSERT INTO lists (id, user_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(list.id, userId, list.name, position, new Date().toISOString());
    list.items.forEach((item) => this.insertItem(list.id, item, Number.MAX_SAFE_INTEGER));
  }

  private insertItem(listId: string, item: Item, index: number): void {
    if (this.db.prepare("SELECT 1 FROM items WHERE id = ?").get(item.id)) throw new OpError("item already exists");
    const position = this.openSlot("items", "list_id", listId, index);
    this.db
      .prepare("INSERT INTO items (id, list_id, name, checked, quantity, position) VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.id, listId, item.name, item.checked ? 1 : 0, item.quantity, position);
  }

  /** Makes room at `index` (clamped to the end) and returns the position to use. */
  private openSlot(table: "lists" | "items", key: string, owner: number | string, index: number): number {
    const count = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} = ?`).get(owner) as any).n;
    const position = Math.min(index, count);
    this.db.prepare(`UPDATE ${table} SET position = position + 1 WHERE ${key} = ? AND position >= ?`).run(owner, position);
    return position;
  }

  private renumber(table: "lists" | "items", key: string, owner: number | string): void {
    const rows = this.db.prepare(`SELECT id FROM ${table} WHERE ${key} = ? ORDER BY position`).all(owner) as any[];
    const stmt = this.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
    rows.forEach((row, index) => stmt.run(index, row.id));
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---------- used by the Siri endpoint ----------

  findItems(userId: number): { listId: string; listName: string; item: Item }[] {
    const state = this.getState(userId);
    return state.lists.flatMap((list) => list.items.map((item) => ({ listId: list.id, listName: list.name, item })));
  }
}
