//! DrawThing's desktop shell: the web app in a native window, with its artwork, settings and
//! exports in a library folder the user chooses (see `library`).

mod closing;
mod launch;
pub mod library;

use library::commands::{self as lib_cmd, LibraryState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // First, so a second launch exits before doing anything else: its files go to this window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            launch::add_args(app, argv.into_iter().skip(1), Some(cwd.into()));
            launch::focus(app);
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = LibraryState::load(app.handle())?;
            app.manage(state);
            app.manage(launch::LaunchState::default());
            app.manage(closing::CloseState::default());
            launch::add_args(app.handle(), std::env::args().skip(1), None);
            Ok(())
        })
        .on_window_event(closing::on_window_event)
        .invoke_handler(tauri::generate_handler![
            lib_cmd::library_list,
            lib_cmd::library_get,
            lib_cmd::library_thumb,
            lib_cmd::library_load_tiles,
            lib_cmd::library_save,
            lib_cmd::library_rename,
            lib_cmd::library_duplicate,
            lib_cmd::library_delete,
            lib_cmd::library_last_open,
            lib_cmd::library_set_last_open,
            lib_cmd::settings_read_all,
            lib_cmd::settings_write,
            lib_cmd::library_info,
            lib_cmd::library_pick_folder,
            lib_cmd::library_inspect,
            lib_cmd::library_set,
            lib_cmd::library_reveal,
            lib_cmd::export_save,
            launch::launch_take,
            launch::launch_read,
            closing::app_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting DrawThing")
        .run(|_app, _event| {
            // macOS hands over opened files as an event, not as arguments.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                launch::add(_app, urls.into_iter().filter_map(|u| u.to_file_path().ok()));
            }
        });
}
