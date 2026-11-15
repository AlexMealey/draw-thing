//! Choosing where the library lives, and moving it there.

use super::store::{copy_dir, dir_size, file_count, ENTRIES, META};
use super::{Ctx, Res};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// What a folder the user picked holds, relative to the current library.
#[derive(Serialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum FolderKind {
    /// It is the current library.
    Current,
    /// It's inside the current library.
    Nested,
    /// It holds another DrawThing library.
    Library,
    /// Empty (or not created yet): the library can go straight in.
    Empty,
    /// It has other files: the library would go in a `DrawThing` subfolder.
    OtherFiles,
    /// Can't be written.
    Unwritable,
}

/// Files the OS drops into folders, which don't make one "not empty".
const IGNORED: [&str; 3] = ["desktop.ini", ".DS_Store", "Thumbs.db"];

/// A path for comparing: canonical where it exists, else its parent's canonical path + name.
fn canonical(path: &Path) -> PathBuf {
    if let Ok(p) = dunce::canonicalize(path) {
        return p;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => canonical(parent).join(name),
        _ => path.to_path_buf(),
    }
}

pub fn inspect(current: &Path, target: &Path) -> FolderKind {
    let (cur, tgt) = (canonical(current), canonical(target));
    if cur == tgt {
        return FolderKind::Current;
    }
    if tgt.starts_with(&cur) {
        return FolderKind::Nested;
    }
    if target.join(META).is_file() {
        return FolderKind::Library;
    }
    if !writable(target) {
        return FolderKind::Unwritable;
    }
    let empty = fs::read_dir(target).map_or(true, |entries| {
        entries
            .flatten()
            .all(|e| e.file_name().to_str().is_some_and(|n| IGNORED.contains(&n)))
    });
    if empty {
        FolderKind::Empty
    } else {
        FolderKind::OtherFiles
    }
}

/// Whether files can be created in `dir` (or in the nearest existing folder above it).
fn writable(dir: &Path) -> bool {
    let mut probe_dir = dir;
    while !probe_dir.exists() {
        match probe_dir.parent() {
            Some(p) => probe_dir = p,
            None => return false,
        }
    }
    let probe = probe_dir.join(".drawthing-write-test");
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

/// Moves a library's files from `from` into `to`, which must not hold any of them already.
///
/// Within one drive this is a rename per entry. Across drives (where rename fails) everything is
/// copied and checked first, and only then is the original deleted, so a failure part-way leaves
/// the original library intact.
pub fn move_library(from: &Path, to: &Path) -> Res<()> {
    fs::create_dir_all(to).ctx(format_args!("Couldn't create {}", to.display()))?;
    let entries: Vec<&str> = ENTRIES
        .into_iter()
        .filter(|e| from.join(e).exists())
        .collect();
    if let Some(e) = entries.iter().find(|e| to.join(e).exists()) {
        return Err(format!("{} already has a {e}", to.display()));
    }

    let mut renamed = Vec::new();
    for e in &entries {
        if fs::rename(from.join(e), to.join(e)).is_err() {
            // Put back what moved, then copy instead.
            for done in renamed.iter().rev() {
                let _ = fs::rename(to.join(done), from.join(done));
            }
            return copy_library(from, to, &entries);
        }
        renamed.push(*e);
    }
    let _ = fs::remove_dir(from); // only if it's now empty
    Ok(())
}

fn copy_library(from: &Path, to: &Path, entries: &[&str]) -> Res<()> {
    fs::create_dir_all(to).ctx(format_args!("Couldn't create {}", to.display()))?;
    let remove = |path: PathBuf| {
        let _ = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
    };
    for (i, e) in entries.iter().enumerate() {
        let (src, dst) = (from.join(e), to.join(e));
        let copied = copy_dir(&src, &dst).and_then(|()| {
            if file_count(&src) == file_count(&dst) && dir_size(&src) == dir_size(&dst) {
                Ok(())
            } else {
                Err(format!("The copy of {e} doesn't match the original"))
            }
        });
        if let Err(err) = copied {
            entries[..=i].iter().for_each(|e| remove(to.join(e)));
            return Err(err);
        }
    }
    entries.iter().for_each(|e| remove(from.join(e)));
    let _ = fs::remove_dir(from);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::store::Library;

    #[test]
    fn kinds() {
        let dir = tempfile::tempdir().unwrap();
        let cur = dir.path().join("lib");
        Library::open(&cur).unwrap();
        let other = dir.path().join("other");
        Library::open(&other).unwrap();
        let empty = dir.path().join("empty");
        fs::create_dir(&empty).unwrap();
        fs::write(empty.join("desktop.ini"), b"").unwrap();
        let full = dir.path().join("full");
        fs::create_dir(&full).unwrap();
        fs::write(full.join("notes.txt"), b"hi").unwrap();

        assert_eq!(inspect(&cur, &cur), FolderKind::Current);
        assert_eq!(inspect(&cur, &cur.join("artworks")), FolderKind::Nested);
        assert_eq!(inspect(&cur, &other), FolderKind::Library);
        assert_eq!(inspect(&cur, &empty), FolderKind::Empty);
        assert_eq!(
            inspect(&cur, &dir.path().join("not-yet")),
            FolderKind::Empty
        );
        assert_eq!(inspect(&cur, &full), FolderKind::OtherFiles);
        // The folder holding the current library has other files: it'd go in a subfolder.
        assert_eq!(inspect(&cur, dir.path()), FolderKind::OtherFiles);
    }

    fn library_with_art(root: &Path) {
        let lib = Library::open(root).unwrap();
        lib.set_setting("drawthing:tools", Some("{}")).unwrap();
        fs::create_dir_all(root.join("artworks/p/tiles/L")).unwrap();
        fs::write(root.join("artworks/p/tiles/L/0.bin"), b"tile").unwrap();
    }

    #[test]
    fn moves_by_rename() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a"), dir.path().join("b"));
        library_with_art(&from);
        move_library(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(
            fs::read(to.join("artworks/p/tiles/L/0.bin")).unwrap(),
            b"tile"
        );
        assert!(to.join("settings/tools.json").is_file());
        assert!(to.join(META).is_file());
    }

    #[test]
    fn copies_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a"), dir.path().join("b"));
        library_with_art(&from);
        copy_library(&from, &to, &[META, "settings", "artworks"]).unwrap();
        assert!(!from.exists());
        assert_eq!(
            fs::read(to.join("artworks/p/tiles/L/0.bin")).unwrap(),
            b"tile"
        );
    }

    #[test]
    fn refuses_to_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a"), dir.path().join("b"));
        library_with_art(&from);
        Library::open(&to).unwrap();
        assert!(move_library(&from, &to).is_err());
        assert!(
            from.join("artworks/p/tiles/L/0.bin").is_file(),
            "original untouched"
        );
    }
}
