//! Saving PDFs chosen by the user (Save / Save As).

use percent_encoding::percent_decode_str;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};

fn ensure_pdf(path: &Path) -> Result<(), String> {
    let ok = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if ok { Ok(()) } else { Err("บันทึกได้เฉพาะไฟล์ .pdf".into()) }
}

/// PDF, or the image types "PDF → รูปภาพ" exports.
fn ensure_writable(path: &Path) -> Result<(), String> {
    let ok = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["pdf", "png", "jpg"].contains(&e.to_ascii_lowercase().as_str()));
    if ok { Ok(()) } else { Err("บันทึกได้เฉพาะไฟล์ .pdf .png .jpg".into()) }
}

/// Writes next to the target first, then swaps it in, so a failed save
/// never leaves a half-written file in place of the original.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("pdf.saving");
    std::fs::write(&tmp, bytes).map_err(|e| format!("บันทึกไม่ได้: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("บันทึกไม่ได้ (ไฟล์อาจเปิดอยู่ในโปรแกรมอื่น): {e}")
    })
}

/// Raw body = file bytes (PDF, or PNG/JPG page images); header `x-path` = percent-encoded destination path.
/// With header `x-unique`, never overwrites: adds " (2)", " (3)"… to the name instead.
/// Returns the path actually written.
#[tauri::command]
pub async fn write_pdf(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("ข้อมูลไฟล์ไม่ถูกต้อง".into());
    };
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("ไม่ได้ระบุตำแหน่งบันทึก")?;
    let path = PathBuf::from(
        percent_decode_str(encoded)
            .decode_utf8()
            .map_err(|e| e.to_string())?
            .into_owned(),
    );
    ensure_writable(&path)?;
    let path = match (request.headers().contains_key("x-unique"), path.parent(), path.file_stem(), path.extension()) {
        (true, Some(dir), Some(stem), Some(ext)) => {
            crate::projects::unique_path(dir, &stem.to_string_lossy(), &ext.to_string_lossy())
        }
        _ => path,
    };
    write_atomic(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Save As for an unmodified file: plain copy, no need to send bytes over IPC.
#[tauri::command]
pub async fn copy_pdf(src: String, dest: String) -> Result<(), String> {
    let (src, dest) = (PathBuf::from(src), PathBuf::from(dest));
    ensure_pdf(&dest)?;
    if src == dest {
        return Ok(());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("อ่านไฟล์ต้นฉบับไม่ได้: {e}"))?;
    write_atomic(&dest, &bytes)
}
