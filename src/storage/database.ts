import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const forbidden = /^(?:message|text|access_token|token|cookie|url|secret|password)$/i;
export function safeState<T extends Record<string, unknown>>(value: T): T { for (const key of Object.keys(value)) if (forbidden.test(key)) throw new Error(`Поле ${key} не допускается в локальном состоянии.`); return value; }
export const defaultDataDir = () => join(process.env.LOCALAPPDATA || process.cwd(), "mcp-insta");
export class LocalState {
  readonly directory: string;
  constructor(directory = defaultDataDir()) { this.directory = directory; mkdirSync(directory, { recursive: true }); }
  // The schema is intentionally documented and created by migration at deployment time.
  schema() { return ["account_binding", "conversation_cursors", "operations", "audit_log", "schema_migrations"]; }
  async initialize() { const { DatabaseSync } = await import("node:sqlite"); const db = new DatabaseSync(join(this.directory, "state.sqlite")); db.exec(readFileSync(new URL("./migrations/001_initial.sql", import.meta.url), "utf8")); return db; }
  async getAccountBinding(): Promise<{ accountId: string; accountType: string } | undefined> {
    const db = await this.initialize();
    try {
      const row = (db as unknown as { prepare(sql: string): { get(): unknown } }).prepare("SELECT account_id, account_type FROM account_binding LIMIT 1").get() as { account_id?: string; account_type?: string } | undefined;
      return row?.account_id && row.account_type ? { accountId: row.account_id, accountType: row.account_type } : undefined;
    } finally { db.close(); }
  }
  async setAccountBinding(accountId: string, accountType: string): Promise<void> {
    safeState({ account_id: accountId, account_type: accountType });
    const db = await this.initialize();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM account_binding");
      (db as unknown as { prepare(sql: string): { run(...values: string[]): void } }).prepare("INSERT INTO account_binding (account_id, account_type, created_at) VALUES (?, ?, ?)").run(accountId, accountType, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* Transaction may not have started. */ }
      throw error;
    } finally { db.close(); }
  }
  async clearAccountBinding(): Promise<void> {
    const db = await this.initialize();
    try { db.exec("DELETE FROM account_binding"); } finally { db.close(); }
  }
  async getMessagingPageId(): Promise<string | undefined> {
    const db = await this.initialize();
    try { const row = (db as unknown as { prepare(sql: string): { get(): unknown } }).prepare("SELECT page_id FROM messaging_binding LIMIT 1").get() as { page_id?: string } | undefined; return row?.page_id; } finally { db.close(); }
  }
  async setMessagingPageId(pageId: string): Promise<void> {
    safeState({ page_id: pageId }); const db = await this.initialize();
    try { db.exec("DELETE FROM messaging_binding"); (db as unknown as { prepare(sql: string): { run(...values: string[]): void } }).prepare("INSERT INTO messaging_binding (page_id, created_at) VALUES (?, ?)").run(pageId, new Date().toISOString()); } finally { db.close(); }
  }
}
