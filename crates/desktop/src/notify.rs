//! Notifica di Windows ("toast") quando l'app e' pronta: un clic apre l'indirizzo
//! dell'app nel browser (attivazione di tipo protocollo, senza callback).
//!
//! Un programma non installato da Microsoft Store deve registrare un AppUserModelID
//! con nome e icona: lo si fa in HKCU (nessun privilegio amministrativo), cosi' la
//! notifica mostra il nome del prodotto.

#![allow(unsafe_code)] // API Win32 del registro

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

/// Identificativo dell'app per le notifiche (es. `Mosaikit.Desktop.Geoportal`).
fn aumid(name: &str) -> String {
    let clean: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    format!("Mosaikit.Desktop.{}", if clean.is_empty() { "App" } else { &clean })
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Nome e icona mostrati nelle notifiche.
fn register(id: &str, app: &App) -> windows::core::Result<()> {
    let key = wide(&format!("Software\\Classes\\AppUserModelId\\{id}"));
    let mut h = HKEY::default();
    // SAFETY: chiave e valori UTF-16 terminati da zero che vivono fino al ritorno; la chiave
    // aperta viene chiusa.
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

/// Mostra "<nome> e' pronto" con l'indirizzo; il clic apre il browser.
pub fn ready(app: &App) -> windows::core::Result<()> {
    // SAFETY: inizializzazione WinRT del thread (gia' inizializzato: risultato ignorato).
    unsafe {
        let _ = RoInitialize(RO_INIT_SINGLETHREADED);
    }
    let id = aumid(&app.name);
    register(&id, app)?;
    let xml = format!(
        "<toast activationType=\"protocol\" launch=\"{url}\">\
           <visual><binding template=\"ToastGeneric\">\
             <text>{name} e' pronto</text>\
             <text>{url}</text>\
             <text>Clic per aprire nel browser</text>\
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
    fn id_e_testo_sicuri() {
        assert_eq!(super::aumid("Geoportal 2.0!"), "Mosaikit.Desktop.Geoportal20");
        assert_eq!(super::aumid("***"), "Mosaikit.Desktop.App");
        assert_eq!(super::esc("a<b>&\"c\""), "a&lt;b&gt;&amp;&quot;c&quot;");
    }
}
