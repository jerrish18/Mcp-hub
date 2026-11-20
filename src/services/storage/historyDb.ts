import type { Conversation } from '../../types';

const DB_NAME = 'mcphub_history_db';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';
const LS_FALLBACK_KEY = 'mcphub_conversations_v1';

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function readLocalStorageFallback(): Conversation[] {
  try {
    const raw = globalThis.localStorage?.getItem(LS_FALLBACK_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

function writeLocalStorageFallback(list: Conversation[]): void {
  try {
    globalThis.localStorage?.setItem(LS_FALLBACK_KEY, JSON.stringify(list));
  } catch {
    // ignore storage quota failures
  }
}

export const historyDb = {
  async listConversations(): Promise<Conversation[]> {
    const db = await openDatabase();
    if (!db) {
      return readLocalStorageFallback().sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as Conversation[]) ?? [];
        resolve(rows.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      req.onerror = () => resolve(readLocalStorageFallback());
    });
  },

  async saveConversation(conv: Conversation): Promise<void> {
    const sanitized: Conversation = {
      ...conv,
      messages: conv.messages.map((m) => ({ ...m, isStreaming: false })),
    };
    const db = await openDatabase();
    if (!db) {
      const all = readLocalStorageFallback().filter((c) => c.id !== sanitized.id);
      all.unshift(sanitized);
      writeLocalStorageFallback(all);
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(sanitized);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  async deleteConversation(id: string): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      writeLocalStorageFallback(readLocalStorageFallback().filter((c) => c.id !== id));
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  async searchConversations(query: string): Promise<Conversation[]> {
    const all = await this.listConversations();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  },

  async clearAll(): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      writeLocalStorageFallback([]);
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },
};
