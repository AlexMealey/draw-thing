//! The library folder: artwork as plain files, settings, and the Exports folder.
//!
//! ```text
//! <library>/
//!   library.json                 { "format": 1, "app": "DrawThing", "lastOpen": "<id>" }
//!   settings/<name>.json         a zustand store ("drawthing:<name>"), as the app wrote it
//!   artworks/<id>/project.json   name, size, dates and the SavedDocument
//!   artworks/<id>/thumb.png      gallery thumbnail
//!   artworks/<id>/tiles/<layer>/<key>.bin   one deflated 256² tile, as stored in IndexedDB
//!   artworks/<id>/journal.bin    only while a save is being applied (see `journal`)
//!   Exports/                     where the Save dialog starts
//! ```
//!
//! Everything here is plain blocking file I/O on a path; `commands` runs it off the main thread.

pub mod commands;
pub mod config;
pub mod frame;
pub mod journal;
pub mod location;
pub mod store;

pub use store::StoredProject;

use std::fmt::Display;

pub type Res<T> = Result<T, String>;

/// Attaches what was being done to an error, for the message the app shows.
pub trait Ctx<T> {
    fn ctx(self, what: impl Display) -> Res<T>;
}

impl<T, E: Display> Ctx<T> for Result<T, E> {
    fn ctx(self, what: impl Display) -> Res<T> {
        self.map_err(|e| format!("{what}: {e}"))
    }
}

/// Project and layer ids become folder names: letters, digits, `_` and `-` only (the same rule
/// as `.drawthing` tile paths), so nothing can point outside the library.
pub fn check_id(id: &str) -> Res<()> {
    let ok = !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid id {id:?}"))
    }
}

#[cfg(test)]
mod tests {
    use super::check_id;

    #[test]
    fn ids() {
        assert!(check_id("abc-123_X").is_ok());
        for bad in ["", "..", "a/b", "a\\b", "a b", "é", &"x".repeat(101)] {
            assert!(check_id(bad).is_err(), "{bad:?}");
        }
    }
}
