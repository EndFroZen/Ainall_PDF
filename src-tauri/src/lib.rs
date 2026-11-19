mod files;
mod projects;

use tauri_plugin_sql::{Migration, MigrationKind};

// ⚠ Migration SQL is checksummed by sqlx. Never edit an applied migration —
// not even whitespace — or existing databases refuse to open. Add a new one instead.
const MIGRATION_1: &str = r#"
            CREATE TABLE IF NOT EXISTS recent_files (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                path       TEXT NOT NULL UNIQUE,
                name       TEXT NOT NULL,
                page_count INTEGER,
                opened_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        "#;

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: MIGRATION_1,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_projects",
            sql: r#"
                CREATE TABLE IF NOT EXISTS projects (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    name       TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS project_files (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    name       TEXT NOT NULL,
                    path       TEXT NOT NULL,
                    page_count INTEGER,
                    size_bytes INTEGER,
                    added_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

// PDFs are read by pdf.js straight from disk through the asset protocol
// (tauri.conf.json → app.security.assetProtocol), which supports range
// requests, so large files never pass through IPC in one piece.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ainall.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            files::write_pdf,
            files::copy_pdf,
            projects::project_create_dir,
            projects::project_dir_path,
            projects::project_remove_dir,
            projects::project_import_pdf,
            projects::project_rename_file,
            projects::project_remove_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
