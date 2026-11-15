//! The binary framing shared with `src/persistence/desktop/frame.ts`:
//!
//! ```text
//! u32 little-endian header length | header (UTF-8 JSON) | body bytes
//! ```
//!
//! The header says where each item sits in the body as `(offset, length)` pairs relative to the
//! body's start. Tiles cross the IPC boundary as raw bytes this way, never as JSON number arrays.

use super::{Ctx, Res};
use serde::{de::DeserializeOwned, Serialize};

pub fn split(buf: &[u8]) -> Res<(&[u8], &[u8])> {
    let len = buf
        .get(..4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("Truncated frame")?;
    let end = 4usize
        .checked_add(len)
        .filter(|&e| e <= buf.len())
        .ok_or("Truncated frame header")?;
    Ok((&buf[4..end], &buf[end..]))
}

pub fn decode<H: DeserializeOwned>(buf: &[u8]) -> Res<(H, &[u8])> {
    let (header, body) = split(buf)?;
    Ok((
        serde_json::from_slice(header).ctx("Bad frame header")?,
        body,
    ))
}

pub fn encode<H: Serialize>(header: &H, body: &[u8]) -> Res<Vec<u8>> {
    let json = serde_json::to_vec(header).ctx("Couldn't encode frame header")?;
    let len = u32::try_from(json.len()).map_err(|_| "Frame header too large")?;
    let mut out = Vec::with_capacity(4 + json.len() + body.len());
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(body);
    Ok(out)
}

/// The bytes at `(offset, len)` in a body, or an error if they aren't all there.
pub fn slice(body: &[u8], offset: u64, len: u64) -> Res<&[u8]> {
    let start = usize::try_from(offset).map_err(|_| "Bad offset")?;
    let len = usize::try_from(len).map_err(|_| "Bad length")?;
    start
        .checked_add(len)
        .and_then(|end| body.get(start..end))
        .ok_or_else(|| "Frame item out of range".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let buf = encode(&vec![1, 2, 3], b"hello").unwrap();
        let (h, body): (Vec<u32>, _) = decode(&buf).unwrap();
        assert_eq!(h, vec![1, 2, 3]);
        assert_eq!(slice(body, 1, 3).unwrap(), b"ell");
        assert!(slice(body, 3, 3).is_err());
    }

    #[test]
    fn truncated() {
        assert!(split(&[1, 0]).is_err());
        assert!(split(&[9, 0, 0, 0, b'{']).is_err());
    }
}
