//! Windows notification ("toast") when the app is ready: a click opens the address
//! of the app in the browser (protocol activation, no callback).
//!
//! A program not installed from the Microsoft Store must register an AppUserModelID
//! with name and icon: it is done in HKCU (no administrative privilege), so the
//! notification shows the name of the product.

#![allow(unsafe_code)] // Win32 registry API

use windows::core::{HSTRING, PCWSTR};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
    REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_SINGLETHREADED};
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

use crate::App;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Identifier of the app for the notifications (e.g. `Mosaikit.Desktop.Atlas`).
fn aumid(name: &str) -> String {
    let clean: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    format!("Mosaikit.Desktop.{}", if clean.is_empty() { "App" } else { &clean })
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Name and icon shown in the notifications.
fn register(id: &str, app: &App) -> windows::core::Result<()> {
    let key = wide(&format!("Software\\Classes\\AppUserModelId\\{id}"));
    let mut h = HKEY::default();
    // SAFETY: zero-terminated UTF-16 key and values that live until the return; the opened
    // key is closed.
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut h,
            None,
        )
        .ok()?;
        for (name, value) in
            [("DisplayName", app.name.clone()), ("IconUri", app.icon_file.to_string_lossy().into_owned())]
        {
            let n = wide(name);
            let v = wide(&value);
            let bytes = std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 2);
            let _ = RegSetValueExW(h, PCWSTR(n.as_ptr()), None, REG_SZ, Some(bytes));
        }
        let _ = RegCloseKey(h);
    }
    Ok(())
}

/// Shows "<name> is ready" with the address; a click opens the browser.
pub fn ready(app: &App) -> windows::core::Result<()> {
    // SAFETY: WinRT initialization of the thread (already initialized: result ignored).
    unsafe {
        let _ = RoInitialize(RO_INIT_SINGLETHREADED);
    }
    let id = aumid(&app.name);
    register(&id, app)?;
    let xml = format!(
        "<toast activationType=\"protocol\" launch=\"{url}\">\
           <visual><binding template=\"ToastGeneric\">\
             <text>{name} is ready</text>
             <text>{url}</text>\
             <text>Click to open in the browser</text>
           </binding></visual>\
         </toast>",
        url = esc(&app.app_url),
        name = esc(&app.name),
    );
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id))?.Show(&toast)
}

#[cfg(test)]
mod tests {
    #[test]
    fn safe_ids_and_text() {
        assert_eq!(super::aumid("Atlas 2.0!"), "Mosaikit.Desktop.Atlas20");
        assert_eq!(super::aumid("***"), "Mosaikit.Desktop.App");
        assert_eq!(super::esc("a<b>&\"c\""), "a&lt;b&gt;&amp;&quot;c&quot;");
    }
}
