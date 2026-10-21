//! Icona nell'area di notifica di Windows e ciclo dei messaggi.

#![allow(unsafe_code)] // API Win32: ciclo dei messaggi e MessageBox

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
    // SAFETY: stringhe UTF-16 terminate da zero, vive fino al ritorno della chiamata.
    unsafe {
        MessageBoxW(std::ptr::null_mut(), x.as_ptr(), t.as_ptr(), flags);
    }
}

/// Usa la console del terminale da cui e' stato lanciato l'eseguibile (che non ha
/// una console propria): l'output dei comandi di amministrazione appare li'.
pub fn attach_parent_console() {
    // SAFETY: chiamata Win32 senza puntatori; se non c'e' un terminale non fa nulla.
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

/// App pronta: al primo avvio si apre il browser, poi una notifica con l'indirizzo
/// (un clic la apre). Con `open_browser = false` sempre e solo la notifica.
fn announce(app: &App) {
    if app.first_run && app.open_browser {
        mosaikit_server::open_browser(&app.app_url);
        let _ = std::fs::write(crate::first_run_marker(&app.data_dir), "");
        return;
    }
    if let Err(e) = crate::notify::ready(app) {
        // senza notifiche (es. disattivate): si ripiega sul browser
        tracing::warn!("notifica non mostrata: {e}");
        if app.open_browser {
            mosaikit_server::open_browser(&app.app_url);
        }
    }
}

/// Smista i messaggi Windows in attesa (necessario per icona e menu).
fn pump(timeout: Duration) {
    // SAFETY: chiamate Win32 standard sul thread che possiede l'icona; MSG e' POD.
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
    let open = MenuItem::new(format!("Apri {}", app.name), true, None);
    let creds = MenuItem::new("Credenziali iniziali", true, None);
    let data = MenuItem::new("Cartella dei dati", true, None);
    let log = MenuItem::new("Log", true, None);
    let quit = MenuItem::new("Esci", true, None);
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
    // icona del marchio (.ico) o quella di Mosaikit disegnata dal codice
    let icon = app
        .icon
        .as_ref()
        .and_then(|p| Icon::from_path(p, Some((32, 32))).ok())
        .map(Ok)
        .unwrap_or_else(|| Icon::from_rgba(crate::icon::render(32), 32, 32))
        .unwrap_or_else(|e| crate::fatal(&format!("icona: {e}")));
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(format!("{} — avvio in corso…", app.name))
        .with_icon(icon)
        .build()
        .unwrap_or_else(|e| crate::fatal(&format!("icona nell'area di notifica: {e}")));

    let mut stop = Some(stop);
    let mut ready = false;
    let started = std::time::Instant::now();
    loop {
        pump(Duration::from_millis(100));
        // avvio lento (primo avvio, PostgreSQL embedded): finestra con fase e spinner
        if !ready && stop.is_some() && started.elapsed() > Duration::from_millis(500) {
            crate::splash::show(app);
        }
        match status.try_recv() {
            Ok(Status::Progress(p)) => {
                tracing::info!("avvio: {p}");
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
                crate::fatal(&format!("{e}\n\nDettagli nel log: {}", app.log_file.display()));
            }
            Ok(Status::Stopped(err)) => {
                if let Some(e) = err {
                    message_box(&app.name, &format!("Il server si e' fermato: {e}"), true);
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
                let f = app.data_dir.join("initial-admin-password.txt");
                if f.is_file() {
                    open_file(&f);
                } else {
                    message_box(
                        &app.name,
                        "Il file con la password iniziale non c'e' piu' (eliminato dopo il primo accesso o password impostata con MOSAIKIT_ADMIN_PASSWORD).",
                        false,
                    );
                }
            } else if ev.id == *data.id() {
                open_file(&app.data_dir);
            } else if ev.id == *log.id() {
                open_file(&app.log_file);
            } else if ev.id == *quit.id() {
                let _ = tray.set_tooltip(Some(format!("{} — arresto in corso…", app.name)));
                if let Some(tx) = stop.take() {
                    let _ = tx.send(());
                }
                if !ready {
                    // ancora in avvio: si attende la fine dell'avvio, poi l'arresto
                    tracing::info!("uscita richiesta durante l'avvio");
                }
            }
        }
    }
}
