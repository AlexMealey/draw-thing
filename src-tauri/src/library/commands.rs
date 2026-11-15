//! The library as Tauri commands (`src/persistence/desktop/fsBackend.ts`,
//! `src/platform/desktop.ts`). One lock serialises everything that touches the library, and the
//! file work runs on a blocking thread so the UI never waits on the disk.

use super::config::{self, Config};
use super::location::{self, FolderKind};
use super::store::{Library, Project, Summary};
use super::{frame, Ctx, Res};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub struct LibraryState {
    lib: Arc<Mutex<Library>>,
    config_dir: PathBuf,
    default_dir: PathBuf,
    /// The chosen folder couldn't be opened at launch (say, a drive that isn't plugged in), so
    /// this session uses the default library.
    unavailable: Mutex<Option<String>>,
}

impl LibraryState {
    pub fn load(app: &AppHandle) -> Res<Self> {
        let paths = app.path();
        let config_dir = paths.app_config_dir().ctx("No settings folder")?;
        let default_dir = paths
            .document_dir()
            .map(|d| d.join("DrawThing"))
            .or_else(|_| paths.app_data_dir().map(|d| d.join("Library")))
            .ctx("No folder for the library")?;
        let mut unavailable = None;
        let lib = match config::load(&config_dir).library_dir {
            Some(dir) => Library::open(&dir).or_else(|e| {
                eprintln!("{e}; using the default library");
                unavailable = Some(dir.display().to_string());
                Library::open(&default_dir)
            })?,
            None => Library::open(&default_dir)?,
        };
        Ok(LibraryState {
            lib: Arc::new(Mutex::new(lib)),
            config_dir,
            default_dir,
            unavailable: Mutex::new(unavailable),
        })
    }

    /// Runs `f` on the library, on a blocking thread.
    async fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Library) -> Res<T> + Send + 'static,
    ) -> Res<T> {
        let lib = self.lib.clone();
        blocking(move || f(&lock(&lib))).await
    }

    fn root(&self) -> PathBuf {
        lock(&self.lib).root().to_path_buf()
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn raw_body(request: &Request<'_>) -> Res<Vec<u8>> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("Expected binary data".into()),
    }
}

// --- Artwork -------------------------------------------------------------------------------

#[tauri::command]
pub async fn library_list(state: State<'_, LibraryState>) -> Res<Vec<Summary>> {
    state.run(|lib| lib.list()).await
}

#[tauri::command]
pub async fn library_get(id: String, state: State<'_, LibraryState>) -> Res<Option<Project>> {
    state.run(move |lib| lib.get(&id)).await
}

/// The PNG's bytes; none if the artwork has no thumbnail.
#[tauri::command]
pub async fn library_thumb(id: String, state: State<'_, LibraryState>) -> Res<Response> {
    state
        .run(move |lib| lib.thumb(&id))
        .await
        .map(Response::new)
}

#[tauri::command]
pub async fn library_load_tiles(id: String, state: State<'_, LibraryState>) -> Res<Response> {
    state
        .run(move |lib| lib.load_tiles(&id))
        .await
        .map(Response::new)
}

/// Body: a framed `journal::SaveHeader` and the tile and thumbnail bytes.
#[tauri::command]
pub async fn library_save(request: Request<'_>, state: State<'_, LibraryState>) -> Res<()> {
    let buf = raw_body(&request)?;
    state.run(move |lib| lib.save(&buf)).await
}

#[tauri::command]
pub async fn library_rename(id: String, name: String, state: State<'_, LibraryState>) -> Res<()> {
    state.run(move |lib| lib.rename(&id, &name)).await
}

#[tauri::command]
pub async fn library_duplicate(
    id: String,
    new_id: String,
    name: String,
    now: i64,
    state: State<'_, LibraryState>,
) -> Res<bool> {
    state
        .run(move |lib| lib.duplicate(&id, &new_id, &name, now))
        .await
}

#[tauri::command]
pub async fn library_delete(id: String, state: State<'_, LibraryState>) -> Res<()> {
    state.run(move |lib| lib.delete(&id)).await
}

#[tauri::command]
pub async fn library_last_open(state: State<'_, LibraryState>) -> Res<Option<String>> {
    state.run(|lib| lib.last_open()).await
}

#[tauri::command]
pub async fn library_set_last_open(id: String, state: State<'_, LibraryState>) -> Res<()> {
    state.run(move |lib| lib.set_last_open(&id)).await
}

// --- Settings ------------------------------------------------------------------------------

#[tauri::command]
pub async fn settings_read_all(state: State<'_, LibraryState>) -> Res<BTreeMap<String, String>> {
    state.run(|lib| lib.settings()).await
}

#[tauri::command]
pub async fn settings_write(
    key: String,
    value: Option<String>,
    state: State<'_, LibraryState>,
) -> Res<()> {
    state
        .run(move |lib| lib.set_setting(&key, value.as_deref()))
        .await
}

// --- Where the library is ------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    path: String,
    default_path: String,
    bytes: u64,
    /// The chosen folder, if it couldn't be opened and the default is in use instead.
    unavailable: Option<String>,
}

#[tauri::command]
pub async fn library_info(state: State<'_, LibraryState>) -> Res<LibraryInfo> {
    let default_path = state.default_dir.display().to_string();
    let unavailable = lock(&state.unavailable).clone();
    state
        .run(move |lib| {
            Ok(LibraryInfo {
                path: lib.root().display().to_string(),
                default_path,
                bytes: lib.size(),
                unavailable,
            })
        })
        .await
}

#[tauri::command]
pub async fn library_pick_folder(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Res<Option<String>> {
    let root = state.root();
    let start = root.parent().unwrap_or(&root).to_path_buf();
    blocking(move || {
        Ok(app
            .dialog()
            .file()
            .set_title("Choose where DrawThing keeps your artwork")
            .set_directory(start)
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.display().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn library_inspect(path: String, state: State<'_, LibraryState>) -> Res<FolderKind> {
    let root = state.root();
    blocking(move || Ok(location::inspect(&root, Path::new(&path)))).await
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetMode {
    /// Move the current library into the (empty) folder.
    Move,
    /// Use the library in the folder, or start an empty one there; the current one stays.
    Switch,
}

/// Points the app at another folder. The page reloads afterwards to read it.
#[tauri::command]
pub async fn library_set(path: String, mode: SetMode, state: State<'_, LibraryState>) -> Res<()> {
    let lib = state.lib.clone();
    let config_dir = state.config_dir.clone();
    blocking(move || {
        let target = PathBuf::from(path);
        let mut lib = lock(&lib);
        let current = lib.root().to_path_buf();
        match (location::inspect(&current, &target), mode) {
            (FolderKind::Current, _) => return Ok(()),
            (FolderKind::Empty, SetMode::Move) => location::move_library(&current, &target)?,
            (FolderKind::Empty | FolderKind::Library, SetMode::Switch) => {}
            (FolderKind::Nested, _) => {
                return Err("That folder is inside the current library".into())
            }
            (FolderKind::Unwritable, _) => {
                return Err("DrawThing can't write to that folder".into())
            }
            (FolderKind::Library | FolderKind::OtherFiles, SetMode::Move) => {
                return Err("That folder isn't empty".into())
            }
            (FolderKind::OtherFiles, SetMode::Switch) => {
                return Err("That folder has other files in it".into())
            }
        }
        *lib = Library::open(&target)?;
        config::save(
            &config_dir,
            &Config {
                library_dir: Some(target),
            },
        )
    })
    .await?;
    *lock(&state.unavailable) = None;
    Ok(())
}

#[tauri::command]
pub async fn library_reveal(app: AppHandle, state: State<'_, LibraryState>) -> Res<()> {
    let root = state.root();
    app.opener()
        .open_path(root.display().to_string(), None::<&str>)
        .ctx("Couldn't open the folder")
}

// --- Exports -------------------------------------------------------------------------------

#[derive(Deserialize)]
struct ExportHeader {
    filename: String,
}

/// Body: a framed `{ filename }` and the file. Shows the Save dialog in the library's Exports
/// folder and writes the file there; false if the user cancelled.
#[tauri::command]
pub async fn export_save(
    app: AppHandle,
    request: Request<'_>,
    state: State<'_, LibraryState>,
) -> Res<bool> {
    let buf = raw_body(&request)?;
    let exports = state.run(|lib| lib.exports_dir()).await?;
    blocking(move || {
        let (header, body): (ExportHeader, _) = frame::decode(&buf)?;
        let ext = Path::new(&header.filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_owned();
        let mut dialog = app
            .dialog()
            .file()
            .set_directory(&exports)
            .set_file_name(&header.filename);
        if !ext.is_empty() {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
        }
        let Some(picked) = dialog.blocking_save_file() else {
            return Ok(false);
        };
        let path = picked.into_path().ctx("Can't save there")?;
        fs::write(&path, body).ctx(format_args!("Couldn't save {}", path.display()))?;
        Ok(true)
    })
    .await
}
