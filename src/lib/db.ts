import Database from "@tauri-apps/plugin-sql";

// Stored in the app data dir (e.g. %APPDATA%\com.ainall.pdf\ainall.db).
// Schema is created by migrations in src-tauri/src/lib.rs.
export const DB_URL = "sqlite:ainall.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load(DB_URL);
  return dbPromise;
}

export interface RecentFile {
  id: number;
  path: string;
  name: string;
  page_count: number | null;
  opened_at: string;
}

export async function addRecentFile(path: string, name: string, pageCount?: number) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO recent_files (path, name, page_count, opened_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT(path) DO UPDATE SET
       name = excluded.name,
       page_count = COALESCE(excluded.page_count, recent_files.page_count),
       opened_at = CURRENT_TIMESTAMP`,
    [path, name, pageCount ?? null],
  );
}

export async function listRecentFiles(limit = 20): Promise<RecentFile[]> {
  const db = await getDb();
  return db.select<RecentFile[]>(
    "SELECT * FROM recent_files ORDER BY opened_at DESC LIMIT $1",
    [limit],
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
