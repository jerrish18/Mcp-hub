import * as SQLite from 'expo-sqlite';
import type { Conversation } from '@core/types';

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
          messagesJson TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updatedAt DESC);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export const sqliteHistoryDb = {
  async listConversations(): Promise<Conversation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: string;
      title: string;
      agentId: string;
      modelId: string;
      effort: 'low' | 'medium' | 'high';
      messagesJson: string;
      createdAt: number;
      updatedAt: number;
    }>('SELECT * FROM conversations ORDER BY updatedAt DESC');
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      agentId: r.agentId,
      modelId: r.modelId,
      effort: r.effort,
      messages: JSON.parse(r.messagesJson),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },

  async saveConversation(conv: Conversation): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO conversations (id, title, agentId, modelId, effort, messagesJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conv.id,
        conv.title,
        conv.agentId,
        conv.modelId,
        conv.effort,
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
    const rows = await db.getAllAsync<{
      id: string;
      title: string;
      agentId: string;
      modelId: string;
      effort: 'low' | 'medium' | 'high';
      messagesJson: string;
      createdAt: number;
      updatedAt: number;
    }>(
      'SELECT * FROM conversations WHERE title LIKE ? OR messagesJson LIKE ? ORDER BY updatedAt DESC',
      [like, like]
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      agentId: r.agentId,
      modelId: r.modelId,
      effort: r.effort,
      messages: JSON.parse(r.messagesJson),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
};
