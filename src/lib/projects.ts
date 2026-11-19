import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./db";
import { countPages } from "./pdf";

export interface Project {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  file_count: number;
  page_total: number;
}

export interface ProjectFile {
  id: number;
  project_id: number;
  name: string;
  path: string;
  page_count: number | null;
  size_bytes: number | null;
  added_at: string;
}

interface DiskFile {
  path: string;
  name: string;
  size: number;
}

/** SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS". */
export function parseDbDate(s: string) {
  return new Date(s.replace(" ", "T") + "Z");
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    `SELECT p.*, COUNT(f.id) AS file_count, COALESCE(SUM(f.page_count), 0) AS page_total
       FROM projects p LEFT JOIN project_files f ON f.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id DESC`,
  );
}

export async function getProject(id: number): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<Project[]>(
    `SELECT p.*, COUNT(f.id) AS file_count, COALESCE(SUM(f.page_count), 0) AS page_total
       FROM projects p LEFT JOIN project_files f ON f.project_id = p.id
      WHERE p.id = $1 GROUP BY p.id`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createProject(name: string): Promise<number> {
  const db = await getDb();
  const res = await db.execute("INSERT INTO projects (name) VALUES ($1)", [name.trim()]);
  const id = res.lastInsertId!;
  try {
    await invoke("project_create_dir", { id });
  } catch (e) {
    await db.execute("DELETE FROM projects WHERE id = $1", [id]);
    throw e;
  }
  return id;
}

async function touch(id: number) {
  const db = await getDb();
  await db.execute("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
}

export async function renameProject(id: number, name: string) {
  const db = await getDb();
  await db.execute("UPDATE projects SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [name.trim(), id]);
}

export async function deleteProject(id: number) {
  await invoke("project_remove_dir", { id });
  const db = await getDb();
  await db.execute("DELETE FROM project_files WHERE project_id = $1", [id]);
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

export async function projectDir(id: number): Promise<string> {
  return invoke<string>("project_dir_path", { id });
}

export async function listFiles(projectId: number): Promise<ProjectFile[]> {
  const db = await getDb();
  return db.select<ProjectFile[]>(
    "SELECT * FROM project_files WHERE project_id = $1 ORDER BY added_at DESC, id DESC",
    [projectId],
  );
}

/**
 * Copies PDFs into the project folder and records them.
 * Returns the names that failed (with reasons) so the UI can report them.
 */
export async function importFiles(
  projectId: number,
  sources: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ failed: { name: string; reason: string }[] }> {
  const db = await getDb();
  const failed: { name: string; reason: string }[] = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    try {
      const f = await invoke<DiskFile>("project_import_pdf", { id: projectId, src });
      const pages = await countPages(f.path);
      await db.execute(
        "INSERT INTO project_files (project_id, name, path, page_count, size_bytes) VALUES ($1, $2, $3, $4, $5)",
        [projectId, f.name, f.path, pages, f.size],
      );
    } catch (e) {
      failed.push({ name: src.split(/[\\/]/).pop() ?? src, reason: String(e) });
    }
    onProgress?.(i + 1, sources.length);
  }
  await touch(projectId);
  return { failed };
}

export async function renameFile(file: ProjectFile, newName: string) {
  const f = await invoke<DiskFile>("project_rename_file", { path: file.path, newName });
  const db = await getDb();
  await db.execute("UPDATE project_files SET name = $1, path = $2 WHERE id = $3", [f.name, f.path, file.id]);
  await touch(file.project_id);
}

export async function deleteFile(file: ProjectFile) {
  await invoke("project_remove_file", { path: file.path });
  const db = await getDb();
  await db.execute("DELETE FROM project_files WHERE id = $1", [file.id]);
  await touch(file.project_id);
}

export function formatBytes(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(s: string) {
  return parseDbDate(s).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}
