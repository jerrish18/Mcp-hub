import * as SQLite from 'expo-sqlite';
import type { ChatMode, Conversation, KnowledgeSourceMode } from '@core/types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('mcphub.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          agentId TEXT NOT NULL,
          modelId TEXT NOT NULL,
          effort TEXT NOT NULL,
          chatMode TEXT DEFAULT 'professional',
          knowledgeSource TEXT DEFAULT 'auto',
          studyInstructions TEXT DEFAULT '',
          messagesJson TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updatedAt DESC);
        CREATE TABLE IF NOT EXISTS kv_state (
          key TEXT PRIMARY KEY NOT NULL,
          valueJson TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
      // Safe migrations for existing installations created before new columns existed
      const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(conversations)');
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('chatMode')) {
        await db.execAsync("ALTER TABLE conversations ADD COLUMN chatMode TEXT DEFAULT 'professional'");
      }
      if (!colNames.has('knowledgeSource')) {
        await db.execAsync("ALTER TABLE conversations ADD COLUMN knowledgeSource TEXT DEFAULT 'auto'");
      }
      if (!colNames.has('studyInstructions')) {
        await db.execAsync("ALTER TABLE conversations ADD COLUMN studyInstructions TEXT DEFAULT ''");
      }
      return db;
    })();
  }
  return dbPromise;
}

interface ConvRow {
  id: string;
  title: string;
  agentId: string;
  modelId: string;
  effort: 'low' | 'medium' | 'high';
  chatMode?: string | null;
  knowledgeSource?: string | null;
  studyInstructions?: string | null;
  messagesJson: string;
  createdAt: number;
  updatedAt: number;
}

function mapRow(r: ConvRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    agentId: r.agentId,
    modelId: r.modelId,
    effort: r.effort,
    chatMode: (r.chatMode as ChatMode) || 'professional',
    knowledgeSource: (r.knowledgeSource as KnowledgeSourceMode) || 'auto',
    studyInstructions: r.studyInstructions ?? '',
    messages: JSON.parse(r.messagesJson),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const sqliteHistoryDb = {
  async listConversations(): Promise<Conversation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ConvRow>(
      'SELECT * FROM conversations ORDER BY updatedAt DESC'
    );
    return rows.map(mapRow);
  },

  async saveConversation(conv: Conversation): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO conversations
       (id, title, agentId, modelId, effort, chatMode, knowledgeSource, studyInstructions, messagesJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conv.id,
        conv.title,
        conv.agentId,
        conv.modelId,
        conv.effort,
        conv.chatMode ?? 'professional',
        conv.knowledgeSource ?? 'auto',
        conv.studyInstructions ?? '',
        JSON.stringify(conv.messages),
        conv.createdAt,
        conv.updatedAt,
      ]
    );
  },

  async deleteConversation(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
  },

  async searchConversations(query: string): Promise<Conversation[]> {
    const db = await getDb();
    const like = `%${query.trim()}%`;
    const rows = await db.getAllAsync<ConvRow>(
      'SELECT * FROM conversations WHERE title LIKE ? OR messagesJson LIKE ? ORDER BY updatedAt DESC',
      [like, like]
    );
    return rows.map(mapRow);
  },

  async getKv<T>(key: string): Promise<T | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ valueJson: string }>(
      'SELECT valueJson FROM kv_state WHERE key = ?',
      [key]
    );
    if (!row) return null;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return null;
    }
  },

  async setKv<T>(key: string, value: T): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      'INSERT OR REPLACE INTO kv_state (key, valueJson, updatedAt) VALUES (?, ?, ?)',
      [key, JSON.stringify(value), Date.now()]
    );
  },
};
