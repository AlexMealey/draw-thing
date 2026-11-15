//! Crash-safe saves. IndexedDB wrote each autosave in one transaction; here a save is first
//! written whole to `journal.bin` (fsynced, then renamed into place: the commit point), then
//! applied to the tile, thumbnail and project files, then the journal is deleted. A journal left
//! behind by a crash is applied again before the artwork is next read or written. Applying is
//! idempotent, so the files always end up as one complete save, never half of one.
//!
//! The tile files themselves are written directly, without their own fsync: until the journal is
//! deleted it can always rewrite them, and an OS-level crash after that is the one case the
//! journal doesn't cover (a power cut moments after a save).

use super::frame;
use super::store::{
    read_project, remove_dir_all_if_exists, remove_file_if_exists, write_json_atomic,
};
use super::{check_id, Ctx, Res, StoredProject};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

pub const JOURNAL: &str = "journal.bin";
const JOURNAL_TMP: &str = "journal.bin.tmp";
/// A journal that couldn't be applied is set aside here, so the artwork still opens.
const JOURNAL_FAILED: &str = "journal.failed";

/// One autosave, as `src/persistence/desktop/fsBackend.ts` frames it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHeader {
    pub id: String,
    /// Used only if the project doesn't exist yet.
    pub name: String,
    /// Used only if the project doesn't exist yet (an import keeps its creation date).
    pub created_at: Option<i64>,
    /// The save's time, fixed in the journal so a replay writes the same dates.
    pub now: i64,
    pub width: u32,
    pub height: u32,
    pub doc: Value,
    /// `tiles` is the complete set: drop every stored tile first.
    pub replace_tiles: bool,
    /// Layers whose tiles all go.
    pub removed_layers: Vec<String>,
    /// `(layer, tile key, offset, length)`; a negative length deletes the tile.
    pub tiles: Vec<(String, u32, u64, i64)>,
    /// `(offset, length)` of a new thumbnail PNG; absent keeps the old one.
    pub thumb: Option<(u64, u64)>,
}

pub struct Save<'a> {
    pub header: SaveHeader,
    pub body: &'a [u8],
}

/// Decodes and checks a save completely, so a bad one is refused before anything is written.
pub fn parse(buf: &[u8]) -> Res<Save<'_>> {
    let (header, body): (SaveHeader, _) = frame::decode(buf)?;
    check_id(&header.id)?;
    for layer in &header.removed_layers {
        check_id(layer)?;
    }
    for (layer, _, offset, len) in &header.tiles {
        check_id(layer)?;
        if *len >= 0 {
            frame::slice(body, *offset, *len as u64)?;
        }
    }
    if let Some((offset, len)) = header.thumb {
        frame::slice(body, offset, len)?;
    }
    Ok(Save { header, body })
}

/// Writes `buf` (already checked by `parse`) to the journal, applies it, and clears it.
pub fn commit(dir: &Path, buf: &[u8], save: &Save) -> Res<()> {
    recover(dir)?;
    fs::create_dir_all(dir).ctx("Couldn't create the artwork folder")?;
    let tmp = dir.join(JOURNAL_TMP);
    let journal = dir.join(JOURNAL);
    {
        let mut f = fs::File::create(&tmp).ctx("Couldn't write the save journal")?;
        f.write_all(buf).ctx("Couldn't write the save journal")?;
        f.sync_all().ctx("Couldn't write the save journal")?;
    }
    fs::rename(&tmp, &journal).ctx("Couldn't commit the save journal")?;
    apply(dir, save)?;
    fs::remove_file(&journal).ctx("Couldn't clear the save journal")
}

/// Finishes a save a crash interrupted, and drops one that never committed.
pub fn recover(dir: &Path) -> Res<()> {
    remove_file_if_exists(&dir.join(JOURNAL_TMP))?;
    let journal = dir.join(JOURNAL);
    let buf = match fs::read(&journal) {
        Ok(buf) => buf,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Couldn't read the save journal: {e}")),
    };
    match parse(&buf).and_then(|save| apply(dir, &save)) {
        Ok(()) => fs::remove_file(&journal).ctx("Couldn't clear the save journal"),
        Err(e) => {
            eprintln!(
                "Setting aside a save journal that can't be applied ({}): {e}",
                dir.display()
            );
            fs::rename(&journal, dir.join(JOURNAL_FAILED))
                .ctx("Couldn't set aside the save journal")
        }
    }
}

fn apply(dir: &Path, save: &Save) -> Res<()> {
    let h = &save.header;
    let tiles = dir.join("tiles");
    if h.replace_tiles {
        remove_dir_all_if_exists(&tiles)?;
    }
    for layer in &h.removed_layers {
        remove_dir_all_if_exists(&tiles.join(layer))?;
    }
    let mut made = HashSet::new();
    for (layer, key, offset, len) in &h.tiles {
        let layer_dir = tiles.join(layer);
        let path = layer_dir.join(format!("{key}.bin"));
        if *len < 0 {
            remove_file_if_exists(&path)?;
            continue;
        }
        if made.insert(layer.as_str()) {
            fs::create_dir_all(&layer_dir).ctx("Couldn't create a layer folder")?;
        }
        fs::write(&path, frame::slice(save.body, *offset, *len as u64)?)
            .ctx("Couldn't write a tile")?;
    }
    if let Some((offset, len)) = h.thumb {
        fs::write(dir.join("thumb.png"), frame::slice(save.body, offset, len)?)
            .ctx("Couldn't write the thumbnail")?;
    }
    // The project file goes last: it's what makes a new artwork appear in the gallery.
    let existing = read_project(dir)?;
    let stored = StoredProject {
        id: h.id.clone(),
        name: existing
            .as_ref()
            .map_or_else(|| h.name.clone(), |p| p.name.clone()),
        width: h.width,
        height: h.height,
        created_at: existing
            .as_ref()
            .map(|p| p.created_at)
            .or(h.created_at)
            .unwrap_or(h.now),
        updated_at: h.now,
        doc: h.doc.clone(),
    };
    write_json_atomic(&dir.join("project.json"), &stored)
}
