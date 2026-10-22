//! Icon in the Windows notification area and message loop.

#![allow(unsafe_code)] // Win32 API: message loop and MessageBox

use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::Duration;

use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, MessageBoxW, MsgWaitForMultipleObjects, PeekMessageW, TranslateMessage, MB_ICONERROR,
    MB_ICONINFORMATION, MB_OK, MSG, PM_REMOVE, QS_ALLINPUT,
};

use crate::{App, Status};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn message_box(title: &str, text: &str, error: bool) {
    let (t, x) = (wide(title), wide(text));
    let flags = MB_OK | if error { MB_ICONERROR } else { MB_ICONINFORMATION };
    // SAFETY: zero-terminated UTF-16 strings, alive until the call returns.
    unsafe {
        MessageBoxW(std::ptr::null_mut(), x.as_ptr(), t.as_ptr(), flags);
    }
}

/// Uses the console of the terminal the executable was started from (it has no
/// console of its own): the output of the administration commands appears there.
pub fn attach_parent_console() {
    // SAFETY: Win32 call without pointers; if there is no terminal it does nothing.
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

/// App ready: at the first start the browser opens, then a notification with the address
/// (a click opens it). With `open_browser = false` always and only the notification.
fn announce(app: &App) {
    if app.first_run && app.open_browser {
        mosaikit_server::open_browser(&app.app_url);
        let _ = std::fs::write(crate::first_run_marker(&app.data_dir), "");
        return;
    }
    if let Err(e) = crate::notify::ready(app) {
        // without notifications (e.g. turned off): fall back to the browser
        tracing::warn!("notification not shown: {e}");
        if app.open_browser {
            mosaikit_server::open_browser(&app.app_url);
        }
    }
}

/// Dispatches the pending Windows messages (needed for icon and menu).
fn pump(timeout: Duration) {
    // SAFETY: standard Win32 calls on the thread that owns the icon; MSG is POD.
    unsafe {
        MsgWaitForMultipleObjects(0, std::ptr::null(), 0, timeout.as_millis() as u32, QS_ALLINPUT);
        let mut msg: MSG = std::mem::zeroed();
        while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn open_file(p: &std::path::Path) {
    mosaikit_server::open_browser(&p.display().to_string());
}

pub fn run(app: &App, stop: tokio::sync::oneshot::Sender<()>, status: Receiver<Status>) {
    let open = MenuItem::new(format!("Open {}", app.name), true, None);
    let creds = MenuItem::new("Initial credentials", true, None);
    let data = MenuItem::new("Data folder", true, None);
    let log = MenuItem::new("Log", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::new();
    let sep = PredefinedMenuItem::separator();
    let sep2 = PredefinedMenuItem::separator();
    for r in [
        menu.append(&open),
        menu.append(&sep),
        menu.append(&creds),
        menu.append(&data),
        menu.append(&log),
        menu.append(&sep2),
        menu.append(&quit),
    ] {
        if let Err(e) = r {
            crate::fatal(&format!("menu: {e}"));
        }
    }
    // icon of the brand (.ico) or the Mosaikit one drawn in code
    let icon = app
        .icon
        .as_ref()
        .and_then(|p| Icon::from_path(p, Some((32, 32))).ok())
        .map(Ok)
        .unwrap_or_else(|| Icon::from_rgba(crate::icon::render(32), 32, 32))
        .unwrap_or_else(|e| crate::fatal(&format!("icon: {e}")));
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(format!("{} — starting…", app.name))
        .with_icon(icon)
        .build()
        .unwrap_or_else(|e| crate::fatal(&format!("icon in the notification area: {e}")));

    let mut stop = Some(stop);
    let mut ready = false;
    let started = std::time::Instant::now();
    loop {
        pump(Duration::from_millis(100));
        // slow start (first start, embedded PostgreSQL): window with phase and spinner
        if !ready && stop.is_some() && started.elapsed() > Duration::from_millis(500) {
            crate::splash::show(app);
        }
        match status.try_recv() {
            Ok(Status::Progress(p)) => {
                tracing::info!("start: {p}");
                crate::splash::set_phase(&p);
            }
            Ok(Status::Ready) => {
                ready = true;
                crate::splash::close();
                let _ = tray.set_tooltip(Some(format!("{} — {}", app.name, app.app_url)));
                announce(app);
            }
            Ok(Status::Failed(e)) => {
                crate::splash::close();
                drop(tray);
                crate::fatal(&format!("{e}\n\nDetails in the log: {}", app.log_file.display()));
            }
            Ok(Status::Stopped(err)) => {
                if let Some(e) = err {
                    message_box(&app.name, &format!("The server stopped: {e}"), true);
                }
                break;
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => break,
        }
        while let Ok(ev) = TrayIconEvent::receiver().try_recv() {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                if ready {
                    mosaikit_server::open_browser(&app.app_url);
                }
            }
        }
        while let Ok(ev) = MenuEvent::receiver().try_recv() {
            if ev.id == *open.id() {
                mosaikit_server::open_browser(&app.app_url);
            } else if ev.id == *creds.id() {
                let f = app.data_dir.join(mosaikit_kernel::identity::INITIAL_CREDENTIALS);
                if f.is_file() {
                    open_file(&f);
                } else {
                    message_box(
                        &app.name,
                        "The file with the initial credentials is no longer there (deleted after the first sign-in).",
                        false,
                    );
                }
            } else if ev.id == *data.id() {
                open_file(&app.data_dir);
            } else if ev.id == *log.id() {
                open_file(&app.log_file);
            } else if ev.id == *quit.id() {
                let _ = tray.set_tooltip(Some(format!("{} — shutting down…", app.name)));
                if let Some(tx) = stop.take() {
                    let _ = tx.send(());
                }
                if !ready {
                    // still starting: wait for the start to end, then shut down
                    tracing::info!("quit requested during the start");
                }
            }
        }
    }
}
