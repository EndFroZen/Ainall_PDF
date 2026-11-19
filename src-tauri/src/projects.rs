//! On-disk storage for projects: every project owns a folder under
//! `<app data>/projects/project-<id>/` holding copies of its PDFs.
//! All paths coming from the frontend are checked to stay inside that root.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("สร้างโฟลเดอร์ไม่ได้: {e}"))?;
    Ok(dir)
}

fn project_dir<R: Runtime>(app: &AppHandle<R>, id: i64) -> Result<PathBuf, String> {
    Ok(root(app)?.join(format!("project-{id}")))
}

/// Returns the path if it is an existing entry inside the projects root.
fn inside_root<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let root = root(app)?.canonicalize().map_err(|e| e.to_string())?;
    let real = Path::new(path)
        .canonicalize()
        .map_err(|_| "ไม่พบไฟล์".to_string())?;
    if !real.starts_with(&root) {
        return Err("ไฟล์นี้ไม่ได้อยู่ในโฟลเดอร์โปรเจกต์".into());
    }
    Ok(PathBuf::from(path))
}

/// Makes a user-supplied name safe to use as a Windows file name.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() { "document".into() } else { trimmed }
}

fn strip_pdf_ext(name: &str) -> &str {
    if name.len() > 4 && name[name.len() - 4..].eq_ignore_ascii_case(".pdf") {
        &name[..name.len() - 4]
    } else {
        name
    }
}

/// `dir/stem.pdf`, or `dir/stem (2).pdf`, `(3)`… if taken.
fn unique_pdf_path(dir: &Path, stem: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.pdf"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}).pdf"));
        n += 1;
    }
    candidate
}

fn to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[derive(Serialize)]
pub struct ImportedFile {
    path: String,
    name: String,
    size: u64,
}

#[tauri::command]
pub async fn project_create_dir<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<String, String> {
    let dir = project_dir(&app, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("สร้างโฟลเดอร์ไม่ได้: {e}"))?;
    Ok(to_string(&dir))
}

#[tauri::command]
pub async fn project_dir_path<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<String, String> {
    let dir = project_dir(&app, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(to_string(&dir))
}

#[tauri::command]
pub async fn project_remove_dir<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<(), String> {
    let dir = project_dir(&app, id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("ลบโฟลเดอร์ไม่ได้: {e}"))?;
    }
    Ok(())
}

/// Copies a PDF into the project's folder (never moves or modifies the original).
#[tauri::command]
pub async fn project_import_pdf<R: Runtime>(
    app: AppHandle<R>,
    id: i64,
    src: String,
) -> Result<ImportedFile, String> {
    let src = PathBuf::from(src);
    let is_pdf = src
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("รองรับเฉพาะไฟล์ .pdf".into());
    }
    let dir = project_dir(&app, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = sanitize(&src.file_stem().unwrap_or_default().to_string_lossy());
    let dest = unique_pdf_path(&dir, &stem);
    let size = std::fs::copy(&src, &dest).map_err(|e| format!("คัดลอกไฟล์ไม่ได้: {e}"))?;
    Ok(ImportedFile {
        name: dest.file_name().unwrap().to_string_lossy().into_owned(),
        path: to_string(&dest),
        size,
    })
}

/// Renames a project PDF on disk. Returns the new path.
#[tauri::command]
pub async fn project_rename_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    new_name: String,
) -> Result<ImportedFile, String> {
    let src = inside_root(&app, &path)?;
    let dir = src.parent().ok_or("พาธไม่ถูกต้อง")?.to_path_buf();
    let stem = sanitize(strip_pdf_ext(new_name.trim()));
    let dest = dir.join(format!("{stem}.pdf"));
    let same_file = to_string(&dest).to_lowercase() == path.to_lowercase();
    if dest.exists() && !same_file {
        return Err("มีไฟล์ชื่อนี้อยู่แล้วในโปรเจกต์".into());
    }
    std::fs::rename(&src, &dest).map_err(|e| format!("เปลี่ยนชื่อไม่ได้: {e}"))?;
    let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(ImportedFile {
        name: format!("{stem}.pdf"),
        path: to_string(&dest),
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_illegal_chars_and_trailing_dots() {
        assert_eq!(sanitize(r#"a<b>c:d"e/f\g|h?i*j"#), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize("  report.  "), "report");
        assert_eq!(sanitize("รายงาน ประจำปี"), "รายงาน ประจำปี");
        assert_eq!(sanitize("   "), "document");
        assert_eq!(sanitize("..."), "document");
    }

    #[test]
    fn strip_pdf_ext_is_case_insensitive() {
        assert_eq!(strip_pdf_ext("a.pdf"), "a");
        assert_eq!(strip_pdf_ext("a.PDF"), "a");
        assert_eq!(strip_pdf_ext("a.pdf.txt"), "a.pdf.txt");
        assert_eq!(strip_pdf_ext(".pdf"), ".pdf");
    }

    #[test]
    fn unique_pdf_path_adds_counter() {
        let dir = std::env::temp_dir().join(format!("ainall-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_pdf_path(&dir, "doc");
        assert_eq!(first.file_name().unwrap(), "doc.pdf");
        std::fs::write(&first, b"x").unwrap();
        let second = unique_pdf_path(&dir, "doc");
        assert_eq!(second.file_name().unwrap(), "doc (2).pdf");
        std::fs::write(&second, b"x").unwrap();
        assert_eq!(unique_pdf_path(&dir, "doc").file_name().unwrap(), "doc (3).pdf");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[tauri::command]
pub async fn project_remove_file<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    match inside_root(&app, &path) {
        Ok(p) => std::fs::remove_file(p).map_err(|e| format!("ลบไฟล์ไม่ได้: {e}")),
        // Already gone from disk — nothing to do.
        Err(_) if !Path::new(&path).exists() => Ok(()),
        Err(e) => Err(e),
    }
}
