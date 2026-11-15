//! `config.json` in the app's config folder: where the library is. It lives outside the library,
//! since it's what finds the library.

use super::store::write_json_atomic;
use super::{Ctx, Res};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const FILE: &str = "config.json";

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// None until the user picks a folder: the default library is used.
    #[serde(default)]
    pub library_dir: Option<PathBuf>,
}

/// A missing or unreadable config means defaults; the app still starts.
pub fn load(dir: &Path) -> Config {
    fs::read(dir.join(FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, config: &Config) -> Res<()> {
    fs::create_dir_all(dir).ctx("Couldn't create the settings folder")?;
    write_json_atomic(&dir.join(FILE), config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Config::default());
        let c = Config {
            library_dir: Some(dir.path().join("lib")),
        };
        save(&dir.path().join("cfg"), &c).unwrap();
        assert_eq!(load(&dir.path().join("cfg")), c);
    }
}
