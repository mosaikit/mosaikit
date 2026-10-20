//! VFS (Virtual File System) sandboxato, std-only: filesystem virtuale
//! con root per-utente dentro la data dir di Mosaikit. Infrastructure
//! domain-agnostic (come ziputil): il "file manager" come dominio vive
//! nel plugin/UI; qui c'e' solo lo storage sicuro.
//!
//! Sicurezza: ogni path viene normalizzato e vincolato sotto la root;
//! ".." e path assoluti vengono rifiutati.

use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct VfsEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Ultima modifica, secondi Unix (0 se non disponibile).
    pub modified: u64,
}

#[derive(Debug, Clone)]
pub struct VfsStat {
    pub is_dir: bool,
    /// byte del file, o somma ricorsiva per le cartelle
    pub size: u64,
    pub modified: u64,
    /// solo cartelle: contenuto ricorsivo (file nascosti esclusi)
    pub files: u64,
    pub dirs: u64,
}

pub struct Vfs {
    root: PathBuf,
}

impl Vfs {
    /// Root = <data_dir>/users/<user>/files (creata al volo).
    pub fn new(data_dir: &Path, user: &str) -> Result<Self, String> {
        Self::at(data_dir.join("users").join(safe_segment(user)).join("files"))
    }

    /// Storage di un plugin, condiviso fra gli utenti:
    /// root = <data_dir>/plugin-data/<plugin_id>/files (creata al volo).
    pub fn for_plugin(data_dir: &Path, plugin_id: &str) -> Result<Self, String> {
        Self::at(data_dir.join("plugin-data").join(safe_segment(plugin_id)).join("files"))
    }

    fn at(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(Vfs { root })
    }

    /// Risolve un path relativo vincolandolo sotto la root.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        let rel = rel.trim().trim_start_matches('/');
        let mut out = self.root.clone();
        for comp in Path::new(rel).components() {
            match comp {
                Component::Normal(c) => out.push(c),
                Component::CurDir => {}
                _ => return Err(format!("path non consentito: {rel}")),
            }
        }
        if !out.starts_with(&self.root) { return Err(format!("path fuori root: {rel}")); }
        Ok(out)
    }

    pub fn list(&self, rel: &str) -> Result<Vec<VfsEntry>, String> {
        let dir = self.resolve(rel)?;
        let mut out = Vec::new();
        for e in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let md = match e.metadata() { Ok(m) => m, Err(_) => continue };
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') { continue; }
            out.push(VfsEntry { name, is_dir: md.is_dir(), size: md.len(), modified: mtime(&md) });
        }
        out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
        Ok(out)
    }

    pub fn mkdir(&self, parent: &str, name: &str) -> Result<(), String> {
        check_name(name)?;
        fs::create_dir(self.resolve(&join(parent, name))?).map_err(|e| e.to_string())
    }

    pub fn rename(&self, rel: &str, new_name: &str) -> Result<(), String> {
        check_name(new_name)?;
        let src = self.resolve(rel)?;
        let parent = src.parent().ok_or("parent mancante")?;
        let dst = parent.join(new_name);
        if !dst.starts_with(&self.root) { return Err("destinazione fuori root".into()); }
        if dst == src { return Ok(()); }
        if dst.exists() { return Err(format!("esiste gia' un elemento chiamato {new_name}")); }
        fs::rename(&src, &dst).map_err(|e| e.to_string())
    }

    pub fn delete(&self, rel: &str) -> Result<(), String> {
        let p = self.resolve(rel)?;
        if p == self.root { return Err("non puoi eliminare la root".into()); }
        if p.is_dir() { fs::remove_dir_all(&p).map_err(|e| e.to_string()) }
        else { fs::remove_file(&p).map_err(|e| e.to_string()) }
    }

    pub fn write_file(&self, rel: &str, data: &[u8]) -> Result<u64, String> {
        let p = self.resolve(rel)?;
        if let Some(par) = p.parent() { fs::create_dir_all(par).map_err(|e| e.to_string())?; }
        fs::write(&p, data).map_err(|e| e.to_string())?;
        Ok(data.len() as u64)
    }

    pub fn read_file(&self, rel: &str) -> Result<Vec<u8>, String> {
        fs::read(self.resolve(rel)?).map_err(|e| e.to_string())
    }

    pub fn move_item(&self, from: &str, to_dir: &str) -> Result<(), String> {
        let src = self.resolve(from)?;
        if src == self.root { return Err("non puoi spostare la root".into()); }
        let dst_dir = self.resolve(to_dir)?;
        if !dst_dir.is_dir() { return Err("destinazione non e' una cartella".into()); }
        let name = src.file_name().ok_or("nome sorgente mancante")?;
        let dst = dst_dir.join(name);
        if dst == src { return Ok(()); }
        if dst.starts_with(&src) { return Err("non puoi spostare una cartella dentro se stessa".into()); }
        if dst.exists() { return Err(format!("la destinazione contiene gia' {}", name.to_string_lossy())); }
        fs::rename(&src, &dst).map_err(|e| e.to_string())
    }

    pub fn copy_item(&self, from: &str, to_dir: &str) -> Result<(), String> {
        let src = self.resolve(from)?;
        if src == self.root { return Err("non puoi copiare la root".into()); }
        let dst_dir = self.resolve(to_dir)?;
        if !dst_dir.is_dir() { return Err("destinazione non e' una cartella".into()); }
        let name = src.file_name().ok_or("nome sorgente mancante")?.to_string_lossy().into_owned();
        if dst_dir.starts_with(&src) { return Err("non puoi copiare una cartella dentro se stessa".into()); }
        // nome libero: "a.txt" -> "a (copia).txt" -> "a (copia 2).txt" ...
        let mut dst = dst_dir.join(&name);
        let mut n = 1;
        while dst.exists() {
            dst = dst_dir.join(copy_name(&name, n));
            n += 1;
        }
        copy_recursive(&src, &dst).map_err(|e| e.to_string())
    }

    /// Dettaglio di un elemento: per le cartelle conta ricorsivamente file,
    /// sottocartelle e byte totali.
    pub fn stat(&self, rel: &str) -> Result<VfsStat, String> {
        let p = self.resolve(rel)?;
        let md = fs::metadata(&p).map_err(|e| e.to_string())?;
        let mut st = VfsStat { is_dir: md.is_dir(), size: md.len(), modified: mtime(&md), files: 0, dirs: 0 };
        if st.is_dir {
            st.size = 0;
            walk(&p, &mut |_, md| {
                if md.is_dir() { st.dirs += 1 } else { st.files += 1; st.size += md.len() }
            }).map_err(|e| e.to_string())?;
        }
        Ok(st)
    }

    /// Zip (STORED) di una cartella; i nomi delle entry partono dal nome
    /// della cartella stessa. Limite: MAX_UNZIP_BYTES di contenuto.
    pub fn zip_dir(&self, rel: &str) -> Result<Vec<u8>, String> {
        let dir = self.resolve(rel)?;
        if !dir.is_dir() { return Err("non e' una cartella".into()); }
        let base = if dir == self.root { PathBuf::from("files") }
                   else { PathBuf::from(dir.file_name().ok_or("nome mancante")?) };
        let mut paths = Vec::new();
        let mut total = 0u64;
        walk(&dir, &mut |path, md| {
            if md.is_file() { total += md.len(); paths.push(path.to_path_buf()); }
        }).map_err(|e| e.to_string())?;
        if total > MAX_UNZIP_BYTES as u64 { return Err(format!("cartella troppo grande per lo zip: oltre {} MB", MAX_UNZIP_BYTES >> 20)); }
        let mut entries = Vec::with_capacity(paths.len());
        for path in paths {
            let relp = path.strip_prefix(&dir).map_err(|e| e.to_string())?;
            let name = base.join(relp).to_string_lossy().replace('\\', "/");
            entries.push((name, fs::read(&path).map_err(|e| e.to_string())?));
        }
        Ok(crate::ziputil::write_stored_zip(&entries))
    }

    pub fn is_dir(&self, rel: &str) -> bool {
        self.resolve(rel).map(|p| p.is_dir()).unwrap_or(false)
    }

    /// Estrae uno zip (STORED/DEFLATE) nella cartella `rel_dir`, che viene
    /// SOSTITUITA. Ogni entry passa da `resolve` (niente zip-slip); cartelle
    /// e metadati macOS vengono ignorati. Lo zip e' estratto tutto in memoria
    /// prima di toccare il disco: se e' corrotto la cartella resta com'era.
    /// Ritorna (path relativo a `rel_dir`, dimensione) dei file scritti.
    pub fn unzip(&self, rel_dir: &str, zip: &[u8]) -> Result<Vec<(String, u64)>, String> {
        let dir = self.resolve(rel_dir)?;
        if dir == self.root { return Err("serve una cartella di destinazione".into()); }
        let mut files = Vec::new();
        let mut total = 0usize;
        for e in crate::ziputil::list_entries(zip)? {
            let name = e.name.replace('\\', "/");
            if e.is_dir() || name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") { continue; }
            total += e.size as usize;
            if total > MAX_UNZIP_BYTES { return Err(format!("zip troppo grande: oltre {} MB estratti", MAX_UNZIP_BYTES >> 20)); }
            let target = self.resolve(&join(rel_dir, &name))?;
            if !target.starts_with(&dir) || target == dir { return Err(format!("entry non valida: {name}")); }
            let data = crate::ziputil::extract_entry(zip, &e)?;
            files.push((name, target, data));
        }
        if files.is_empty() { return Err("lo zip non contiene file".into()); }
        if dir.exists() { fs::remove_dir_all(&dir).map_err(|e| e.to_string())?; }
        let mut out = Vec::with_capacity(files.len());
        for (name, target, data) in files {
            if let Some(par) = target.parent() { fs::create_dir_all(par).map_err(|e| e.to_string())?; }
            fs::write(&target, &data).map_err(|e| e.to_string())?;
            out.push((name, data.len() as u64));
        }
        Ok(out)
    }
}

/// Limite di dimensione totale estratta da `unzip` (anti zip-bomb).
pub const MAX_UNZIP_BYTES: usize = 256 << 20;

/// Segmento di path sicuro da un identificativo (utente, id plugin).
fn safe_segment(s: &str) -> String {
    let out: String = s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    // "", "." e ".." non devono diventare componenti di navigazione
    if out.chars().all(|c| c == '.') { format!("_{out}") } else { out }
}

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(format!("nome non valido: {name}"));
    }
    Ok(())
}

fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() || parent == "/" { name.to_string() } else { format!("{}/{}", parent.trim_end_matches('/'), name) }
}

fn mtime(md: &fs::Metadata) -> u64 {
    md.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs()).unwrap_or(0)
}

/// Visita ricorsiva (file nascosti esclusi, come in `list`).
fn walk(dir: &Path, f: &mut dyn FnMut(&Path, &fs::Metadata)) -> std::io::Result<()> {
    for e in fs::read_dir(dir)?.flatten() {
        if e.file_name().to_string_lossy().starts_with('.') { continue; }
        let md = match e.metadata() { Ok(m) => m, Err(_) => continue };
        let path = e.path();
        f(&path, &md);
        if md.is_dir() { walk(&path, f)?; }
    }
    Ok(())
}

/// Nome della n-esima copia, estensione preservata per i file.
fn copy_name(name: &str, n: u32) -> String {
    let tag = if n == 1 { " (copia)".to_string() } else { format!(" (copia {n})") };
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{}{}{}", &name[..i], tag, &name[i..]),
        _ => format!("{name}{tag}"),
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for e in fs::read_dir(src)? {
            let e = e?;
            copy_recursive(&e.path(), &dst.join(e.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(par) = dst.parent() { fs::create_dir_all(par)?; }
        fs::copy(src, dst).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(tag: &str) -> (PathBuf, Vfs) {
        let dir = std::env::temp_dir().join(format!("msk-vfs-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let vfs = Vfs::new(&dir, "user1").unwrap();
        (dir, vfs)
    }

    #[test]
    fn crud_flow() {
        let (_d, vfs) = mk("crud");
        vfs.mkdir("", "docs").unwrap();
        vfs.mkdir("docs", "sub").unwrap();
        vfs.write_file("docs/sub/a.txt", b"ciao").unwrap();
        assert!(vfs.is_dir("docs"));
        let list = vfs.list("docs/sub").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "a.txt");
        vfs.rename("docs/sub/a.txt", "b.txt").unwrap();
        vfs.copy_item("docs/sub", "docs").unwrap();
        let list = vfs.list("docs").unwrap();
        assert!(list.iter().any(|e| e.name == "sub"));
        vfs.move_item("docs/sub/b.txt", "docs").unwrap();
        let list = vfs.list("docs").unwrap();
        assert!(list.iter().any(|e| e.name == "b.txt"));
        assert_eq!(vfs.read_file("docs/b.txt").unwrap(), b"ciao");
        vfs.delete("docs").unwrap();
        assert!(vfs.list("").unwrap().is_empty());
    }

    #[test]
    fn copia_nella_stessa_cartella_e_conflitti() {
        let (_d, vfs) = mk("dup");
        vfs.mkdir("", "d").unwrap();
        vfs.write_file("a.txt", b"1").unwrap();
        vfs.write_file("d/a.txt", b"2").unwrap();
        vfs.copy_item("a.txt", "").unwrap();
        vfs.copy_item("a.txt", "").unwrap();
        let names: Vec<String> = vfs.list("").unwrap().into_iter().map(|e| e.name).collect();
        assert!(names.contains(&"a (copia).txt".to_string()));
        assert!(names.contains(&"a (copia 2).txt".to_string()));
        vfs.copy_item("d", "").unwrap();
        assert!(vfs.is_dir("d (copia)"));
        assert!(vfs.copy_item("d", "d").is_err());
        // move/rename non sovrascrivono
        assert!(vfs.move_item("a.txt", "d").is_err());
        assert!(vfs.rename("a.txt", "a (copia).txt").is_err());
        assert_eq!(vfs.read_file("d/a.txt").unwrap(), b"2");
        assert!(vfs.list("").unwrap().iter().all(|e| e.modified > 0));
        let st = vfs.stat("d").unwrap();
        assert!(st.is_dir && st.files == 1 && st.size == 1 && st.dirs == 0);
        let zip = vfs.zip_dir("d").unwrap();
        assert_eq!(crate::ziputil::extract(&zip, "d/a.txt").unwrap(), b"2");
        assert!(vfs.zip_dir("a.txt").is_err());
    }

    /// zip DEFLATE creato con Python zipfile: sito/ (dir), sito/index.html,
    /// sito/css/style.css, __MACOSX/sito/._index.html
    const SITE_ZIP: &str = "504b03041400000008003c5d545d000000000200000000000000050000007369746f2f0300504b03041400000008003c5d545da6e7277deb000000b80600000f0000007369746f2f696e6465782e68746d6c8dd54d4ec4300c86e1ab980b106cf32b657203569c203486461326556321f5f65453c4966f5345ed2b2ff2a849bc297df26d319afdaba5f8fbb45c52f4eacdd25bf51ec3b18ead5eceb45a3b0ddf9a8dd9cc695eede3348d11aeef6ef7558ae198f0decbb64fe3f4da47aee7eafb074e71496bfdcc7447c51a8d7d3e0dcf5ea74ea5d2b2f6ef1cc3f297319609962996dd63d903963d62d913963d63d90bb8bd2803e8c0200483120c523068c12006831a0c7230e821a087a0ff05e821a087801e027a08e821a087801e027a28e8a1a087a20715e8a1a087821e0a7a28e8a1a087fee7118edb245cafa81f504b03041400000008003c5d545d7ade93d4330000008a000000120000007369746f2f6373732f7374796c652e6373734bca4fa954a85648cbcf2bd14d4bcccdcca9b452284ecc2bd62d4e2dca4cb35648cecfc92fb2525036363656a8e54aa2a16a00504b03041400000008003c5d545d399cfb0606000000040000001a0000005f5f4d41434f53582f7369746f2f2e5f696e6465782e68746d6ccb2acdcb0600504b010214001400000008003c5d545d000000000200000000000000050000000000000000001000fd41000000007369746f2f504b010214001400000008003c5d545da6e7277deb000000b80600000f00000000000000000000008001250000007369746f2f696e6465782e68746d6c504b010214001400000008003c5d545d7ade93d4330000008a00000012000000000000000000000080013d0100007369746f2f6373732f7374796c652e637373504b010214001400000008003c5d545d399cfb0606000000040000001a00000000000000000000008001a00100005f5f4d41434f53582f7369746f2f2e5f696e6465782e68746d6c504b05060000000004000400f8000000de0100000000";

    #[test]
    fn unzip_sostituisce_la_cartella() {
        let dir = std::env::temp_dir().join(format!("msk-vfs-unzip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let vfs = Vfs::for_plugin(&dir, "com.example.sites").unwrap();
        vfs.write_file("s1/vecchio.txt", b"da rimuovere").unwrap();
        let zip = crate::ziputil::tests::hex(SITE_ZIP);
        let files = vfs.unzip("s1", &zip).unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(names, ["sito/index.html", "sito/css/style.css"]);
        assert_eq!(vfs.read_file("s1/sito/index.html").unwrap(), crate::ziputil::tests::sample_html());
        assert!(vfs.read_file("s1/vecchio.txt").is_err());
        // root del plugin non sostituibile, zip corrotto non tocca il disco
        assert!(vfs.unzip("", &zip).is_err());
        assert!(vfs.unzip("s1", &zip[..zip.len() - 30]).is_err());
        assert!(vfs.is_dir("s1/sito"));
    }

    #[test]
    fn unzip_rifiuta_zip_slip() {
        let (_d, vfs) = mk("slip");
        let evil = crate::ziputil::write_stored_zip(&[("../evil.txt".to_string(), b"x".to_vec())]);
        assert!(vfs.unzip("s1", &evil).is_err());
        let evil2 = crate::ziputil::write_stored_zip(&[("a/../../evil.txt".to_string(), b"x".to_vec())]);
        assert!(vfs.unzip("s1", &evil2).is_err());
        assert!(!vfs.is_dir("s1"));
    }

    #[test]
    fn traversal_rifiutato() {
        let (_d, vfs) = mk("sec");
        assert!(vfs.list("../..").is_err());
        assert!(vfs.write_file("../../evil.txt", b"x").is_err());
        assert!(vfs.mkdir("", "..").is_err());
        assert!(vfs.list("").is_ok());
    }
}
