//! Closing the window saves first. The page autosaves half a second after each change, so a
//! window closed right after a stroke would lose it: instead the close waits for the page to
//! save and answer (`app_close`), or 5 seconds if it never does (stuck, or still loading).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, Window, WindowEvent};

const TIMEOUT: Duration = Duration::from_secs(5);

/// Set once the page has saved: the next close goes through.
#[derive(Default)]
pub struct CloseState(AtomicBool);

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.state::<CloseState>().0.load(Ordering::SeqCst) {
        return;
    }
    api.prevent_close();
    let _ = window.emit("close-requested", ());
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(TIMEOUT);
        close(&window);
    });
}

fn close<R: Runtime>(window: &Window<R>) {
    window.state::<CloseState>().0.store(true, Ordering::SeqCst);
    let _ = window.close();
}

/// The page has saved everything: close the window.
#[tauri::command]
pub fn app_close<R: Runtime>(window: Window<R>) {
    close(&window);
}
