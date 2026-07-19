CREATE TABLE IF NOT EXISTS account_binding (account_id TEXT PRIMARY KEY, account_type TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messaging_binding (page_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_cursors (conversation_id TEXT PRIMARY KEY, last_message_id TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (operation_id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, status TEXT NOT NULL, technical_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
