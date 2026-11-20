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

/// The PDF passed on the command line ("Open with" / double-click in Explorer), made absolute.
fn pdf_arg(args: &[String], cwd: &std::path::Path) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.to_ascii_lowercase().ends_with(".pdf"))
        .map(|a| cwd.join(a).to_string_lossy().into_owned())
}

/// The PDF this process was launched with; returned once, so a reload doesn't reopen it.
#[tauri::command]
fn launch_file() -> Option<String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static TAKEN: AtomicBool = AtomicBool::new(false);
    if TAKEN.swap(true, Ordering::SeqCst) {
        return None;
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    pdf_arg(&std::env::args().collect::<Vec<_>>(), &cwd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager};
    tauri::Builder::default()
        // Must be first: a second launch ("Open with" while running) hands its file to this window and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            if let Some(path) = pdf_arg(&args, std::path::Path::new(&cwd)) {
                let _ = app.emit("open-file", path);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ainall.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            launch_file,
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
