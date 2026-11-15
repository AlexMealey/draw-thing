//! Reading and writing artwork, settings and library metadata in a library folder.

use super::{check_id, frame, journal, Ctx, Res};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub const META: &str = "library.json";
pub const ARTWORKS: &str = "artworks";
pub const SETTINGS: &str = "settings";
pub const EXPORTS: &str = "Exports";
/// Everything a library consists of: what moving a library moves.
pub const ENTRIES: [&str; 4] = [META, SETTINGS, ARTWORKS, EXPORTS];
/// Settings keys are the app's zustand store names, `drawthing:<name>`.
const SETTINGS_PREFIX: &str = "drawthing:";

/// `artworks/<id>/project.json`: the ProjectRecord without its thumbnail.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub doc: Value,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub updated_at: i64,
    pub has_thumb: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(flatten)]
    pub stored: StoredProject,
    pub has_thumb: bool,
}

/// `library.json`. It marks a folder as a DrawThing library; unknown fields are kept.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    format: u32,
    app: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_open: Option<String>,
    #[serde(flatten)]
    other: Map<String, Value>,
}

impl Default for Meta {
    fn default() -> Self {
        Meta {
            format: 1,
            app: "DrawThing".into(),
            last_open: None,
            other: Map::new(),
        }
    }
}

pub struct Library {
    root: PathBuf,
}

impl Library {
    /// Opens the library at `root`, creating an empty one if the folder has none.
    pub fn open(root: &Path) -> Res<Self> {
        fs::create_dir_all(root.join(ARTWORKS)).ctx(format_args!(
            "Couldn't create the library at {}",
            root.display()
        ))?;
        let lib = Library {
            root: root.to_path_buf(),
        };
        if !root.join(META).is_file() {
            lib.write_meta(&Meta::default())?;
        }
        Ok(lib)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn exports_dir(&self) -> Res<PathBuf> {
        let dir = self.root.join(EXPORTS);
        fs::create_dir_all(&dir).ctx("Couldn't create the Exports folder")?;
        Ok(dir)
    }

    fn artwork(&self, id: &str) -> Res<PathBuf> {
        check_id(id)?;
        Ok(self.root.join(ARTWORKS).join(id))
    }

    /// An artwork's folder, with any interrupted save finished first.
    fn artwork_recovered(&self, id: &str) -> Res<PathBuf> {
        let dir = self.artwork(id)?;
        if dir.is_dir() {
            journal::recover(&dir)?;
        }
        Ok(dir)
    }

    /// Newest first. An artwork that can't be read is left out (and logged), not fatal.
    pub fn list(&self) -> Res<Vec<Summary>> {
        let entries = match fs::read_dir(self.root.join(ARTWORKS)) {
            Ok(e) => e,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(format!("Couldn't read the library: {e}")),
        };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if check_id(&id).is_err() || !entry.path().is_dir() {
                continue;
            }
            match self.get(&id) {
                Ok(Some(p)) => out.push(Summary {
                    id: p.stored.id,
                    name: p.stored.name,
                    width: p.stored.width,
                    height: p.stored.height,
                    updated_at: p.stored.updated_at,
                    has_thumb: p.has_thumb,
                }),
                Ok(None) => {} // never finished its first save
                Err(e) => eprintln!("Skipping artwork {id}: {e}"),
            }
        }
        out.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Res<Option<Project>> {
        let dir = self.artwork_recovered(id)?;
        Ok(read_project(&dir)?.map(|mut stored| {
            stored.id = id.to_owned(); // the folder name is the truth
            Project {
                stored,
                has_thumb: dir.join("thumb.png").is_file(),
            }
        }))
    }

    /// The thumbnail PNG, or no bytes if there is none.
    pub fn thumb(&self, id: &str) -> Res<Vec<u8>> {
        let path = self.artwork_recovered(id)?.join("thumb.png");
        match fs::read(path) {
            Ok(b) => Ok(b),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(format!("Couldn't read the thumbnail: {e}")),
        }
    }

    /// Every stored tile, framed as `[(layer, key, offset, len)]` + the tile bytes.
    pub fn load_tiles(&self, id: &str) -> Res<Vec<u8>> {
        let tiles_dir = self.artwork_recovered(id)?.join("tiles");
        let mut index: Vec<(String, u32, u64, u64)> = Vec::new();
        let mut body = Vec::new();
        let layers = match fs::read_dir(&tiles_dir) {
            Ok(l) => l,
            Err(e) if e.kind() == ErrorKind::NotFound => return frame::encode(&index, &body),
            Err(e) => return Err(format!("Couldn't read the artwork's tiles: {e}")),
        };
        for layer in layers.flatten() {
            let Some(layer_id) = layer.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if check_id(&layer_id).is_err() {
                continue;
            }
            let Ok(files) = fs::read_dir(layer.path()) else {
                continue;
            };
            for file in files.flatten() {
                let name = file.file_name();
                let Some(key) = name
                    .to_str()
                    .and_then(|n| n.strip_suffix(".bin"))
                    .and_then(|k| k.parse::<u32>().ok())
                else {
                    continue;
                };
                let bytes = fs::read(file.path()).ctx("Couldn't read a tile")?;
                index.push((layer_id.clone(), key, body.len() as u64, bytes.len() as u64));
                body.extend_from_slice(&bytes);
            }
        }
        frame::encode(&index, &body)
    }

    /// One autosave (or a whole new artwork), framed as `journal::SaveHeader` + bytes.
    pub fn save(&self, buf: &[u8]) -> Res<()> {
        let save = journal::parse(buf)?;
        let dir = self.artwork(&save.header.id)?;
        journal::commit(&dir, buf, &save)
    }

    pub fn rename(&self, id: &str, name: &str) -> Res<()> {
        let dir = self.artwork_recovered(id)?;
        if let Some(mut p) = read_project(&dir)? {
            p.name = name.to_owned();
            write_json_atomic(&dir.join("project.json"), &p)?;
        }
        Ok(())
    }

    /// Copies an artwork under a new id and name. False if the original doesn't exist.
    pub fn duplicate(&self, id: &str, new_id: &str, name: &str, now: i64) -> Res<bool> {
        let src = self.artwork_recovered(id)?;
        let Some(mut p) = read_project(&src)? else {
            return Ok(false);
        };
        let dst = self.artwork(new_id)?;
        if dst.exists() {
            return Err(format!("Artwork {new_id} already exists"));
        }
        let result = (|| {
            copy_dir(&src, &dst)?;
            p.id = new_id.to_owned();
            p.name = name.to_owned();
            p.created_at = now;
            p.updated_at = now;
            write_json_atomic(&dst.join("project.json"), &p)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&dst);
        }
        result.map(|()| true)
    }

    pub fn delete(&self, id: &str) -> Res<()> {
        remove_dir_all_if_exists(&self.artwork(id)?)?;
        let mut meta = self.read_meta()?;
        if meta.last_open.as_deref() == Some(id) {
            meta.last_open = None;
            self.write_meta(&meta)?;
        }
        Ok(())
    }

    pub fn last_open(&self) -> Res<Option<String>> {
        Ok(self.read_meta()?.last_open)
    }

    pub fn set_last_open(&self, id: &str) -> Res<()> {
        check_id(id)?;
        let mut meta = self.read_meta()?;
        if meta.last_open.as_deref() != Some(id) {
            meta.last_open = Some(id.to_owned());
            self.write_meta(&meta)?;
        }
        Ok(())
    }

    /// Every stored setting: store name → the JSON string the app wrote.
    pub fn settings(&self) -> Res<BTreeMap<String, String>> {
        let mut out = BTreeMap::new();
        let entries = match fs::read_dir(self.root.join(SETTINGS)) {
            Ok(e) => e,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(format!("Couldn't read the settings: {e}")),
        };
        for entry in entries.flatten() {
            let file = entry.file_name();
            let Some(name) = file.to_str().and_then(|n| n.strip_suffix(".json")) else {
                continue;
            };
            if check_id(name).is_err() {
                continue;
            }
            match fs::read_to_string(entry.path()) {
                Ok(text) => {
                    out.insert(format!("{SETTINGS_PREFIX}{name}"), text);
                }
                Err(e) => eprintln!("Skipping setting {name}: {e}"),
            }
        }
        Ok(out)
    }

    /// Stores one setting; `None` removes it.
    pub fn set_setting(&self, key: &str, value: Option<&str>) -> Res<()> {
        let name = key
            .strip_prefix(SETTINGS_PREFIX)
            .filter(|n| check_id(n).is_ok())
            .ok_or_else(|| format!("Invalid setting name {key:?}"))?;
        let path = self.root.join(SETTINGS).join(format!("{name}.json"));
        match value {
            None => remove_file_if_exists(&path),
            Some(text) => {
                fs::create_dir_all(self.root.join(SETTINGS))
                    .ctx("Couldn't create the settings folder")?;
                write_atomic(&path, text.as_bytes())
            }
        }
    }

    /// Bytes on disk, everything included.
    pub fn size(&self) -> u64 {
        dir_size(&self.root)
    }

    fn read_meta(&self) -> Res<Meta> {
        Ok(read_json(&self.root.join(META))?.unwrap_or_default())
    }

    fn write_meta(&self, meta: &Meta) -> Res<()> {
        write_json_atomic(&self.root.join(META), meta)
    }
}

pub(crate) fn read_project(dir: &Path) -> Res<Option<StoredProject>> {
    read_json(&dir.join("project.json"))
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Res<Option<T>> {
    match fs::read(path) {
        Ok(b) => serde_json::from_slice(&b)
            .map(Some)
            .ctx(format_args!("{} is damaged", path.display())),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Couldn't read {}: {e}", path.display())),
    }
}

/// Writes through a temporary file and a rename, so readers see the old file or the new one.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Res<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).ctx(format_args!("Couldn't write {}", path.display()))?;
    fs::rename(&tmp, path).ctx(format_args!("Couldn't write {}", path.display()))
}

pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Res<()> {
    let bytes = serde_json::to_vec_pretty(value).ctx("Couldn't encode JSON")?;
    write_atomic(path, &bytes)
}

pub(crate) fn remove_file_if_exists(path: &Path) -> Res<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != ErrorKind::NotFound => {
            Err(format!("Couldn't delete {}: {e}", path.display()))
        }
        _ => Ok(()),
    }
}

pub(crate) fn remove_dir_all_if_exists(path: &Path) -> Res<()> {
    match fs::remove_dir_all(path) {
        Err(e) if e.kind() != ErrorKind::NotFound => {
            Err(format!("Couldn't delete {}: {e}", path.display()))
        }
        _ => Ok(()),
    }
}

/// Copies a folder recursively (or a single file). Leftover journals aren't copied.
pub(crate) fn copy_dir(src: &Path, dst: &Path) -> Res<()> {
    if src.is_file() {
        fs::copy(src, dst).ctx(format_args!("Couldn't copy {}", src.display()))?;
        return Ok(());
    }
    fs::create_dir_all(dst).ctx(format_args!("Couldn't create {}", dst.display()))?;
    for entry in fs::read_dir(src).ctx(format_args!("Couldn't read {}", src.display()))? {
        let entry = entry.ctx("Couldn't read a folder entry")?;
        let name = entry.file_name();
        if name == "journal.bin.tmp" {
            continue;
        }
        copy_dir(&entry.path(), &dst.join(&name))?;
    }
    Ok(())
}

/// Total size of the files under `path` (or of the file itself).
pub(crate) fn dir_size(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| dir_size(&e.path())).sum())
            .unwrap_or(0),
        Ok(m) if m.is_file() => m.len(),
        _ => 0,
    }
}

/// Number of files under `path`, for checking a copy.
pub(crate) fn file_count(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| file_count(&e.path())).sum())
            .unwrap_or(0),
        Ok(m) if m.is_file() => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn save_frame(header: Value, body: &[u8]) -> Vec<u8> {
        frame::encode(&header, body).unwrap()
    }

    fn header(id: &str, tiles: Value) -> Value {
        json!({
            "id": id, "name": "Untitled", "now": 1000, "width": 512, "height": 256,
            "doc": { "width": 512, "height": 256, "layers": [{ "id": "L1" }] },
            "replaceTiles": false, "removedLayers": [], "tiles": tiles, "thumb": null,
        })
    }

    fn tiles_of(lib: &Library, id: &str) -> Vec<(String, u32, Vec<u8>)> {
        let buf = lib.load_tiles(id).unwrap();
        let (index, body): (Vec<(String, u32, u64, u64)>, _) = frame::decode(&buf).unwrap();
        let mut out: Vec<_> = index
            .into_iter()
            .map(|(l, k, o, n)| (l, k, frame::slice(body, o, n).unwrap().to_vec()))
            .collect();
        out.sort();
        out
    }

    #[test]
    fn save_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        let mut h = header("p1", json!([["L1", 0, 0, 3], ["L1", 5, 3, 2]]));
        h["thumb"] = json!([5, 1]);
        lib.save(&save_frame(h, b"aaabbT")).unwrap();

        let p = lib.get("p1").unwrap().unwrap();
        assert_eq!(p.stored.name, "Untitled");
        assert_eq!(
            (p.stored.width, p.stored.created_at, p.stored.updated_at),
            (512, 1000, 1000)
        );
        assert!(p.has_thumb);
        assert_eq!(lib.thumb("p1").unwrap(), b"T");
        assert_eq!(
            tiles_of(&lib, "p1"),
            vec![
                ("L1".into(), 0, b"aaa".to_vec()),
                ("L1".into(), 5, b"bb".to_vec())
            ]
        );
        assert!(!dir
            .path()
            .join("artworks/p1")
            .join(journal::JOURNAL)
            .exists());

        // A later save: one tile changes, one goes, the name and creation date stay.
        let mut h = header("p1", json!([["L1", 0, 0, 1], ["L1", 5, 0, -1]]));
        h["now"] = json!(2000);
        h["name"] = json!("Ignored");
        lib.save(&save_frame(h, b"z")).unwrap();
        let p = lib.get("p1").unwrap().unwrap();
        assert_eq!(
            (
                p.stored.name.as_str(),
                p.stored.created_at,
                p.stored.updated_at
            ),
            ("Untitled", 1000, 2000)
        );
        assert_eq!(tiles_of(&lib, "p1"), vec![("L1".into(), 0, b"z".to_vec())]);
        assert_eq!(
            lib.thumb("p1").unwrap(),
            b"T",
            "no new thumbnail keeps the old one"
        );
    }

    #[test]
    fn replace_and_remove_layers() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        lib.save(&save_frame(
            header("p", json!([["L1", 0, 0, 1], ["L2", 1, 1, 1]])),
            b"ab",
        ))
        .unwrap();

        let mut h = header("p", json!([]));
        h["removedLayers"] = json!(["L2"]);
        lib.save(&save_frame(h, b"")).unwrap();
        assert_eq!(tiles_of(&lib, "p"), vec![("L1".into(), 0, b"a".to_vec())]);

        let mut h = header("p", json!([["L3", 7, 0, 1]]));
        h["replaceTiles"] = json!(true);
        lib.save(&save_frame(h, b"c")).unwrap();
        assert_eq!(tiles_of(&lib, "p"), vec![("L3".into(), 7, b"c".to_vec())]);
    }

    #[test]
    fn crash_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        lib.save(&save_frame(header("p", json!([["L1", 0, 0, 1]])), b"a"))
            .unwrap();
        let art = dir.path().join("artworks/p");

        // Crash after the commit point: the journal is there, the files are stale.
        let mut h = header("p", json!([["L1", 0, 0, 1], ["L1", 1, 1, 1]]));
        h["now"] = json!(5000);
        fs::write(art.join(journal::JOURNAL), save_frame(h, b"xy")).unwrap();
        // Crash before it: a half-written journal that must be ignored.
        fs::write(art.join("journal.bin.tmp"), b"\x05\0\0\0{").unwrap();

        assert_eq!(lib.list().unwrap()[0].updated_at, 5000);
        assert_eq!(
            tiles_of(&lib, "p"),
            vec![
                ("L1".into(), 0, b"x".to_vec()),
                ("L1".into(), 1, b"y".to_vec())
            ]
        );
        assert!(!art.join(journal::JOURNAL).exists());
        assert!(!art.join("journal.bin.tmp").exists());

        // A journal that can't be applied is set aside; the artwork still opens.
        fs::write(art.join(journal::JOURNAL), b"garbage").unwrap();
        assert!(lib.get("p").unwrap().is_some());
        assert!(art.join("journal.failed").exists());
    }

    #[test]
    fn refuses_bad_saves() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        assert!(lib
            .save(&save_frame(header("../x", json!([])), b""))
            .is_err());
        assert!(lib
            .save(&save_frame(header("p", json!([["../L", 0, 0, 1]])), b"a"))
            .is_err());
        assert!(lib
            .save(&save_frame(header("p", json!([["L1", 0, 0, 9]])), b"a"))
            .is_err());
        assert!(
            !dir.path().join("artworks/p").exists(),
            "nothing written for a refused save"
        );
        assert!(lib.get("..").is_err());
    }

    #[test]
    fn rename_duplicate_delete_last_open() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        lib.save(&save_frame(header("p", json!([["L1", 0, 0, 1]])), b"a"))
            .unwrap();
        lib.rename("p", "Cat").unwrap();
        assert!(lib.duplicate("p", "q", "Cat copy", 9000).unwrap());
        assert!(!lib.duplicate("missing", "r", "x", 0).unwrap());
        let q = lib.get("q").unwrap().unwrap();
        assert_eq!(
            (
                q.stored.id.as_str(),
                q.stored.name.as_str(),
                q.stored.created_at
            ),
            ("q", "Cat copy", 9000)
        );
        assert_eq!(tiles_of(&lib, "q"), tiles_of(&lib, "p"));
        let names: Vec<_> = lib.list().unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["Cat copy", "Cat"]);

        lib.set_last_open("p").unwrap();
        assert_eq!(lib.last_open().unwrap().as_deref(), Some("p"));
        lib.delete("q").unwrap();
        assert_eq!(lib.last_open().unwrap().as_deref(), Some("p"));
        lib.delete("p").unwrap();
        assert_eq!(lib.last_open().unwrap(), None);
        assert!(lib.list().unwrap().is_empty());
    }

    #[test]
    fn settings_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        lib.set_setting("drawthing:tools", Some(r#"{"state":{}}"#))
            .unwrap();
        lib.set_setting("drawthing:palettes", Some("[]")).unwrap();
        assert!(dir.path().join("settings/tools.json").is_file());
        let all = lib.settings().unwrap();
        assert_eq!(
            all.get("drawthing:tools").map(String::as_str),
            Some(r#"{"state":{}}"#)
        );
        lib.set_setting("drawthing:palettes", None).unwrap();
        assert_eq!(lib.settings().unwrap().len(), 1);
        assert!(lib.set_setting("other:x", Some("1")).is_err());
        assert!(lib.set_setting("drawthing:../x", Some("1")).is_err());
    }
}
