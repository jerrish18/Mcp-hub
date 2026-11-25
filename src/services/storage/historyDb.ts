import { mergeCanvasHistories, type CanvasHistory } from '../../utils/canvasArtifacts';
import type { Conversation } from '../../types';

const DB_NAME = 'mcphub_history_db';
const DB_VERSION = 4;
const CANVAS_WORKSPACE_STORE = 'canvas_workspace';
const CANVAS_STORE_NAME = 'canvas_history';
const LEGACY_STORE_NAME = 'conversations';
const SCOPED_STORE_NAME = 'scoped_conversations';
const LEGACY_LS_FALLBACK_KEY = 'mcphub_conversations_v1';
const LS_FALLBACK_PREFIX = 'mcphub_conversations_v2::';

interface ScopedConversationRow {
  storageKey: string;
  scope: string;
  id: string;
  updatedAt: number;
  conversation: Conversation;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!db) dbPromise = null;
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), 1500);
    try {
      const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CANVAS_WORKSPACE_STORE)) db.createObjectStore(CANVAS_WORKSPACE_STORE);
        if (!db.objectStoreNames.contains(CANVAS_STORE_NAME)) db.createObjectStore(CANVAS_STORE_NAME);
        if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          const legacyStore = db.createObjectStore(LEGACY_STORE_NAME, { keyPath: 'id' });
          legacyStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(SCOPED_STORE_NAME)) {
          const scopedStore = db.createObjectStore(SCOPED_STORE_NAME, { keyPath: 'storageKey' });
          scopedStore.createIndex('scope', 'scope', { unique: false });
          scopedStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return dbPromise;
}

function makeStorageKey(scope: string, id: string): string {
  return `${scope}::${id}`;
}

function readLocalStorageFallback(scope: string): Conversation[] {
  try {
    const raw = globalThis.localStorage?.getItem(`${LS_FALLBACK_PREFIX}${scope}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[];
      return Array.isArray(parsed) ? parsed : [];
    }
    if (scope === 'guest') {
      const legacy = globalThis.localStorage?.getItem(LEGACY_LS_FALLBACK_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as Conversation[];
        if (Array.isArray(parsed)) {
          writeLocalStorageFallback('guest', parsed);
          return parsed;
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

function writeLocalStorageFallback(scope: string, list: Conversation[]): void {
  try {
    globalThis.localStorage?.setItem(`${LS_FALLBACK_PREFIX}${scope}`, JSON.stringify(list));
  } catch {
    // ignore storage quota failures
  }
}

function sanitizeConversation(conv: Conversation): Conversation {
  return {
    ...conv,
    messages: conv.messages.map((m) => ({ ...m, isStreaming: false })),
  };
}

export const historyDb = {
  async readCanvasRecord<T>(key: string): Promise<T | undefined> {
    const db = await openDatabase();
    const stored = db ? await new Promise<T | undefined>((resolve) => {
      try {
        const request = db.transaction(CANVAS_WORKSPACE_STORE).objectStore(CANVAS_WORKSPACE_STORE).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    }) : undefined;
    if (stored !== undefined) return stored;
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined; }
    catch { return undefined; }
  },

  async saveCanvasRecord<T>(key: string, value: T): Promise<boolean> {
    const db = await openDatabase();
    if (!db) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch { return false; }
    }
    const saved = await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(CANVAS_WORKSPACE_STORE, 'readwrite');
        tx.objectStore(CANVAS_WORKSPACE_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onabort = tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    });
    if (saved) {
      try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
    }
    return saved;
  },

  async readCanvas(scope: string, artifactId: string): Promise<CanvasHistory | undefined> {
    const db = await openDatabase();
    const key = JSON.stringify([scope, artifactId]);
    if (!db) {
      try { return JSON.parse(localStorage.getItem('mcphub_canvas:' + key) ?? 'null') ?? undefined; }
      catch { return undefined; }
    }
    return new Promise((resolve) => {
      try {
        const req = db.transaction(CANVAS_STORE_NAME).objectStore(CANVAS_STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  },

  async saveCanvas(scope: string, history: CanvasHistory): Promise<boolean> {
    const db = await openDatabase();
    const key = JSON.stringify([scope, history.artifactId]);
    if (!db) {
      try {
        const storageKey = 'mcphub_canvas:' + key;
        const previous = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as CanvasHistory | null;
        localStorage.setItem(storageKey, JSON.stringify(mergeCanvasHistories(previous ?? undefined, history)));
        return true;
      } catch { return false; }
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(CANVAS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(CANVAS_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => store.put(mergeCanvasHistories(request.result, history), key);
        tx.oncomplete = () => resolve(true);
        tx.onabort = tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  },

  async listConversations(scope = 'guest'): Promise<Conversation[]> {
    const db = await openDatabase();
    if (!db) {
      return readLocalStorageFallback(scope).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(
          db.objectStoreNames.contains(LEGACY_STORE_NAME) && scope === 'guest'
            ? [SCOPED_STORE_NAME, LEGACY_STORE_NAME]
            : [SCOPED_STORE_NAME],
          'readonly'
        );
        const scopedStore = tx.objectStore(SCOPED_STORE_NAME);
        const idx = scopedStore.index('scope');
        const req = idx.getAll(IDBKeyRange.only(scope));
        req.onsuccess = () => {
          const rows = (req.result as ScopedConversationRow[]) ?? [];
          const scopedConvs = rows.map((r) => r.conversation);
          if (
            scopedConvs.length === 0 &&
            scope === 'guest' &&
            db.objectStoreNames.contains(LEGACY_STORE_NAME)
          ) {
            const legacyReq = tx.objectStore(LEGACY_STORE_NAME).getAll();
            legacyReq.onsuccess = () => {
              const legacyRows = (legacyReq.result as Conversation[]) ?? [];
              resolve(legacyRows.sort((a, b) => b.updatedAt - a.updatedAt));
            };
            legacyReq.onerror = () => resolve(readLocalStorageFallback(scope));
            return;
          }
          resolve(scopedConvs.sort((a, b) => b.updatedAt - a.updatedAt));
        };
        req.onerror = () => resolve(readLocalStorageFallback(scope));
      } catch {
        resolve(readLocalStorageFallback(scope));
      }
    });
  },

  async saveConversation(conv: Conversation, scope = 'guest'): Promise<void> {
    const sanitized = sanitizeConversation(conv);
    const db = await openDatabase();
    if (!db) {
      const all = readLocalStorageFallback(scope).filter((c) => c.id !== sanitized.id);
      all.unshift(sanitized);
      writeLocalStorageFallback(scope, all);
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(SCOPED_STORE_NAME, 'readwrite');
        const row: ScopedConversationRow = {
          storageKey: makeStorageKey(scope, sanitized.id),
          scope,
          id: sanitized.id,
          updatedAt: sanitized.updatedAt,
          conversation: sanitized,
        };
        tx.objectStore(SCOPED_STORE_NAME).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },

  async replaceScopeConversations(convs: Conversation[], scope = 'guest'): Promise<void> {
    const sanitizedList = convs.map(sanitizeConversation);
    const db = await openDatabase();
    if (!db) {
      writeLocalStorageFallback(scope, sanitizedList);
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(SCOPED_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SCOPED_STORE_NAME);
        const idx = store.index('scope');
        const existingKeysReq = idx.getAllKeys(IDBKeyRange.only(scope));
        existingKeysReq.onsuccess = () => {
          const keys = (existingKeysReq.result as IDBValidKey[]) ?? [];
          for (const key of keys) {
            store.delete(key);
          }
          for (const conv of sanitizedList) {
            const row: ScopedConversationRow = {
              storageKey: makeStorageKey(scope, conv.id),
              scope,
              id: conv.id,
              updatedAt: conv.updatedAt,
              conversation: conv,
            };
            store.put(row);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },

  async deleteConversation(id: string, scope = 'guest'): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      writeLocalStorageFallback(
        scope,
        readLocalStorageFallback(scope).filter((c) => c.id !== id)
      );
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(SCOPED_STORE_NAME, 'readwrite');
        tx.objectStore(SCOPED_STORE_NAME).delete(makeStorageKey(scope, id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },

  async searchConversations(query: string, scope = 'guest'): Promise<Conversation[]> {
    const all = await this.listConversations(scope);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  },

  async clearAll(scope = 'guest'): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      writeLocalStorageFallback(scope, []);
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(SCOPED_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SCOPED_STORE_NAME);
        const idx = store.index('scope');
        const req = idx.getAllKeys(IDBKeyRange.only(scope));
        req.onsuccess = () => {
          for (const key of (req.result as IDBValidKey[]) ?? []) {
            store.delete(key);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },
};
