//! Files the app is opened with: double-clicking a `.drawthing`, "Open with DrawThing", or
//! dropping a file on the app icon. They come from the command line at launch, from a second
//! launch while the app runs (single-instance plugin), or from macOS's "open" event.
//!
//! The page asks for the paths (`launch_take`), then for each file's bytes (`launch_read`), which
//! only reads files that arrived this way.

use crate::library::{Ctx, Res};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// What `src/files/importFile.ts` can open.
const EXTENSIONS: [&str; 6] = ["drawthing", "psd", "png", "jpg", "jpeg", "webp"];

#[derive(Default)]
pub struct LaunchState {
    /// Waiting for the page to take them.
    pending: Mutex<Vec<PathBuf>>,
    /// Handed to the page and not read yet.
    allowed: Mutex<HashSet<PathBuf>>,
}

/// Command-line arguments that are files we can open. `cwd` resolves relative paths from a
/// second launch.
pub fn add_args<R: Runtime>(
    app: &AppHandle<R>,
    args: impl IntoIterator<Item = String>,
    cwd: Option<PathBuf>,
) {
    let paths = args.into_iter().filter(|a| !a.starts_with('-')).map(|a| {
        let p = PathBuf::from(a);
        match &cwd {
            Some(dir) if p.is_relative() => dir.join(p),
            _ => p,
        }
    });
    add(app, paths);
}

pub fn add<R: Runtime>(app: &AppHandle<R>, paths: impl IntoIterator<Item = PathBuf>) {
    let state = app.state::<LaunchState>();
    let mut added = false;
    for path in paths {
        let known = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
        if !known || !path.is_file() {
            continue;
        }
        state
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(path);
        added = true;
    }
    if added {
        let _ = app.emit("open-files", ());
    }
}

/// Brings the window forward (a second launch hands its files to this one).
pub fn focus<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn launch_take(state: State<'_, LaunchState>) -> Vec<String> {
    let paths: Vec<PathBuf> =
        std::mem::take(&mut *state.pending.lock().unwrap_or_else(PoisonError::into_inner));
    let mut allowed = state.allowed.lock().unwrap_or_else(PoisonError::into_inner);
    paths
        .into_iter()
        .map(|p| {
            let s = p.display().to_string();
            allowed.insert(p);
            s
        })
        .collect()
}

#[tauri::command]
pub async fn launch_read(path: String, state: State<'_, LaunchState>) -> Res<Response> {
    let path = PathBuf::from(path);
    if !state
        .allowed
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&path)
    {
        return Err("Not a file DrawThing was opened with".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&path).ctx(format_args!("Couldn't read {}", path.display()))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}
