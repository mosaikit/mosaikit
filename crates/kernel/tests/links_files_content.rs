//! Public links, files and folders, static sites (contents on disk and tickets).

use std::io::Write;

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::tenancy::set_settings;
use mosaikit_kernel::testing::{start, TestKernel};
use mosaikit_kernel::{content, crud, files, links, uploads, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";
const FILES: &str = "com.mosaikit.files";
const SITES: &str = "com.mosaikit.static-site";

async fn setup() -> (TestKernel, Caller, Caller, Caller) {
    let t = start().await;
    for p in ["notes", "files", "static-site"] {
        t.install(p).await;
    }
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let (g, a, b) = (t.home(&g).await, t.home(&anna).await, t.home(&bruno).await);
    (t, g, a, b)
}

fn token_of(url: &str) -> String {
    url.trim_end_matches('/').rsplit('/').next().unwrap().to_string()
}

async fn note(t: &TestKernel, c: &Caller, title: &str) -> Uuid {
    let row = crud::create(t, c, NOTES, "notes", json!({ "title": title }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn public_links() {
    let (t, mgr, anna, bruno) = setup().await;
    let rid = note(&t, &anna, "public").await;
    let other_session = note(&t, &anna, "private").await;

    // the manage level is required
    set_grant(&t, &anna, rid, "user", bruno.user.user_id, Some(Level::Write)).await.unwrap();
    assert_eq!(links::create(&t, &bruno, rid, None, None).await.unwrap_err().kind, Kind::Forbidden);

    let l = links::create(&t, &anna, rid, Some(7), None).await.unwrap();
    assert!(l.url.starts_with(&t.cfg.public_url));
    assert!(l.info.expires_at.is_some());
    let r = links::resolve(&t, &token_of(&l.url)).await.unwrap();
    assert_eq!(r.resource, rid);
    // the link reads only its resource, read only
    let p = t.plugins.active(NOTES).unwrap();
    let row = crud::get_ctx(&t, &r.ctx(), &p, "notes", rid).await.unwrap();
    assert_eq!(row["values"]["title"], "public");
    assert_eq!(row["my_level"], "read");
    assert_eq!(
        crud::get_ctx(&t, &r.ctx(), &p, "notes", other_session).await.unwrap_err().kind,
        Kind::NotFound
    );
    assert_eq!(crud::list_ctx(&t, &r.ctx(), &p, "notes", None, None).await.unwrap().rows.len(), 1);

    // lifetime beyond the maximum of the tenant (30 days by default)
    assert_eq!(links::create(&t, &anna, rid, Some(365), None).await.unwrap_err().kind, Kind::BadRequest);

    // password
    let lp = links::create(&t, &anna, rid, None, Some("secret1")).await.unwrap();
    let rp = links::resolve(&t, &token_of(&lp.url)).await.unwrap();
    assert!(!links::check_password(&t, &rp, "wrong").await.unwrap());
    assert!(links::check_password(&t, &rp, "secret1").await.unwrap());

    // revocation
    links::revoke(&t, &anna, l.info.id).await.unwrap();
    assert_eq!(links::resolve(&t, &token_of(&l.url)).await.unwrap_err().kind, Kind::NotFound);
    // expiry
    mosaikit_db::query("update core.public_links set expires_at = now() - interval '1 minute' where id = $1")
        .bind(lp.info.id)
        .execute(&t.db)
        .await
        .unwrap();
    assert!(links::resolve(&t, &token_of(&lp.url)).await.is_err());
    // token that does not exist or is malformed
    assert!(links::resolve(&t, "abc").await.is_err());
    assert!(links::resolve(&t, &"0".repeat(48)).await.is_err());

    // policy of the tenant: links turned off
    let l2 = links::create(&t, &anna, rid, None, None).await.unwrap();
    let mut s = mgr.tenant.settings.clone();
    s.public_links_enabled = false;
    set_settings(&t, &mgr, &s).await.unwrap();
    let anna2 = t.caller(&anna.user, "alfa").await;
    assert_eq!(links::create(&t, &anna2, rid, None, None).await.unwrap_err().kind, Kind::Forbidden);
    assert!(links::resolve(&t, &token_of(&l2.url)).await.is_err(), "the existing links stop working");
}

#[tokio::test]
async fn files_and_folders_with_inheritance() {
    let (t, _g, anna, bruno) = setup().await;
    let project = files::mkdir(&t, &anna, FILES, None, "Project").await.unwrap();
    assert!(project.is_dir);
    assert_eq!(
        files::mkdir(&t, &anna, FILES, None, "project").await.unwrap_err().kind,
        Kind::Conflict,
        "case-insensitive names"
    );
    assert_eq!(files::mkdir(&t, &anna, FILES, None, "a/b").await.unwrap_err().kind, Kind::BadRequest);
    let doc = files::upload(&t, &anna, FILES, Some(project.id), "report.txt", b"hello", false).await.unwrap();
    assert_eq!(doc.size, 5);
    assert_eq!(doc.mime, "text/plain");
    assert_eq!(
        files::upload(&t, &anna, FILES, Some(project.id), "report.txt", b"x", false).await.unwrap_err().kind,
        Kind::Conflict
    );
    files::upload(&t, &anna, FILES, Some(project.id), "report.txt", b"hello world", true).await.unwrap();
    let (_, data) = files::read(&t, &anna, FILES, doc.id).await.unwrap();
    assert_eq!(data, b"hello world");

    // bruno sees nothing; with write on the folder he sees and adds files
    assert!(files::list(&t, &bruno, FILES, None).await.unwrap().entries.is_empty());
    assert_eq!(files::read(&t, &bruno, FILES, doc.id).await.unwrap_err().kind, Kind::NotFound);
    set_grant(&t, &anna, project.id, "user", bruno.user.user_id, Some(Level::Write)).await.unwrap();
    let root_b = files::list(&t, &bruno, FILES, None).await.unwrap();
    assert_eq!(root_b.entries.len(), 1, "the shared folder appears in bruno's root");
    let inside = files::list(&t, &bruno, FILES, Some(project.id)).await.unwrap();
    assert_eq!(inside.entries.len(), 1);
    assert_eq!(inside.path.len(), 1);
    assert_eq!(inside.my_level, "write");
    let brunos_file =
        files::upload(&t, &bruno, FILES, Some(project.id), "note.md", b"# note", false).await.unwrap();
    assert_eq!(
        files::delete(&t, &bruno, FILES, doc.id).await.unwrap_err().kind,
        Kind::Forbidden,
        "write is not enough to delete"
    );
    // anna, owner of the folder, also manages bruno's file
    let listed = files::list(&t, &anna, FILES, Some(project.id)).await.unwrap();
    assert_eq!(listed.entries.iter().find(|e| e.id == brunos_file.id).unwrap().my_level, "manage");

    // subfolder, move, copy, zip
    let sub = files::mkdir(&t, &anna, FILES, Some(project.id), "Attachments").await.unwrap();
    files::move_to(&t, &anna, FILES, doc.id, Some(sub.id)).await.unwrap();
    let deep = files::list(&t, &bruno, FILES, Some(sub.id)).await.unwrap();
    assert_eq!(deep.path.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["Project", "Attachments"]);
    assert!(files::move_to(&t, &anna, FILES, project.id, Some(sub.id)).await.is_err(), "no cycles");
    let the_copy = files::copy_to(&t, &bruno, FILES, sub.id, None).await.unwrap();
    assert_eq!(the_copy.owner_id, bruno.user.user_id, "the copy belongs to whoever makes it");
    let inside_the_copy = files::list(&t, &bruno, FILES, Some(the_copy.id)).await.unwrap();
    let (_, copied) = files::read(&t, &bruno, FILES, inside_the_copy.entries[0].id).await.unwrap();
    assert_eq!(copied, b"hello world");
    let (name, zip) = files::zip_folder(&t, &anna, FILES, project.id).await.unwrap();
    assert_eq!(name, "Project.zip");
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(zip)).unwrap();
    let mut names: Vec<String> =
        (0..z.len()).map(|i| z.by_index(i).unwrap().name().unwrap().into_owned()).collect();
    names.sort();
    assert_eq!(names, vec!["Attachments/report.txt", "note.md"]);

    // deletion: the folder and what it contains go to the trash, the contents stay on the disk until
    // the purge; restoring brings everything back
    let blob = t.blobs.file_path(anna.tenant.tenant_id, doc.id);
    assert!(blob.is_file());
    files::delete(&t, &anna, FILES, project.id).await.unwrap();
    assert!(blob.is_file());
    assert!(files::list(&t, &anna, FILES, None).await.unwrap().entries.is_empty());
    assert!(files::read(&t, &anna, FILES, doc.id).await.is_err(), "inside the trash: not readable");
    let in_trash = mosaikit_kernel::trash::list(&t, &anna, None, None).await.unwrap();
    assert_eq!(in_trash.len(), 1, "only the folder, its content goes with it");
    assert_eq!(in_trash[0].size_bytes, 11 + 6, "the folder counts what it contains");
    mosaikit_kernel::trash::restore(&t, &anna, project.id).await.unwrap();
    let (_, back) = files::read(&t, &anna, FILES, doc.id).await.unwrap();
    assert_eq!(back, b"hello world");
    // deleted for good: the contents go away from the disk too
    files::delete(&t, &anna, FILES, project.id).await.unwrap();
    mosaikit_kernel::trash::purge(&t, &anna, project.id).await.unwrap();
    assert!(!blob.exists());
    assert!(mosaikit_kernel::trash::list(&t, &anna, None, None).await.unwrap().is_empty());
}

#[tokio::test]
async fn info_of_a_folder_size_and_public_link() {
    let (t, _g, anna, bruno) = setup().await;
    let folder = files::mkdir(&t, &anna, FILES, None, "Data").await.unwrap();
    let sub = files::mkdir(&t, &anna, FILES, Some(folder.id), "Inner").await.unwrap();
    files::upload(&t, &anna, FILES, Some(folder.id), "a.txt", b"12345", false).await.unwrap();
    files::upload(&t, &anna, FILES, Some(sub.id), "b.txt", b"123", false).await.unwrap();
    let i = files::info(&t, &anna, FILES, folder.id).await.unwrap();
    assert!(i.is_dir && i.can_share);
    assert_eq!(i.size, 8, "every file under the folder");
    assert!(i.public_link.is_none());
    // a link makes it show; its address is not given again
    let l = links::create(&t, &anna, folder.id, None, None).await.unwrap();
    let i = files::info(&t, &anna, FILES, folder.id).await.unwrap();
    assert_eq!(i.public_link.unwrap().id, l.info.id);
    // someone who only reads or writes cannot see the link and cannot share
    set_grant(&t, &anna, folder.id, "user", bruno.user.user_id, Some(Level::Write)).await.unwrap();
    let j = files::info(&t, &bruno, FILES, folder.id).await.unwrap();
    assert!(!j.can_share && j.public_link.is_none());
    assert_eq!(j.size, 8);
    // a folder nobody shared with bruno stays not found
    let hidden = files::mkdir(&t, &anna, FILES, None, "Hidden").await.unwrap();
    assert_eq!(files::info(&t, &bruno, FILES, hidden.id).await.unwrap_err().kind, Kind::NotFound);
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

#[tokio::test]
async fn static_sites_with_tickets() {
    let (t, _g, anna, bruno) = setup().await;
    let site = crud::create(
        &t,
        &anna,
        SITES,
        "sites",
        json!({ "name": "Documentation" }).as_object().unwrap(),
        None,
    )
    .await
    .unwrap();
    let rid: Uuid = site["id"].as_str().unwrap().parse().unwrap();
    let zip = zip_of(&[
        ("doc/index.html", b"<h1>Doc</h1>"),
        ("doc/css/s.css", b"h1{}"),
        ("doc/a/index.html", b"x"),
    ]);
    let info = content::upload_site(&t, &anna, SITES, rid, &zip).await.unwrap();
    assert_eq!(info.files, 3);
    assert_eq!(info.entry, "doc/index.html", "least nested index.html");
    // malicious path
    let evil = zip_of(&[("../outside.html", b"x")]);
    assert_eq!(content::upload_site(&t, &anna, SITES, rid, &evil).await.unwrap_err().kind, Kind::BadRequest);
    // bruno can neither upload nor open
    assert_eq!(content::upload_site(&t, &bruno, SITES, rid, &zip).await.unwrap_err().kind, Kind::NotFound);
    assert_eq!(content::ticket(&t, &bruno, SITES, rid, false).await.unwrap_err().kind, Kind::NotFound);

    set_grant(&t, &anna, rid, "user", bruno.user.user_id, Some(Level::Read)).await.unwrap();
    let tk = content::ticket(&t, &bruno, SITES, rid, false).await.unwrap();
    assert!(tk.url.ends_with("/doc/index.html"), "{}", tk.url);
    let token = tk.url.split("/c/").nth(1).unwrap().split('/').next().unwrap().to_string();
    let target = content::resolve_ticket(&t, &token).await.unwrap();
    assert_eq!(target.resource, rid);
    assert!(t.blobs.site_file(target.tenant, rid, "doc/css/s.css").is_some());
    assert!(t.blobs.site_file(target.tenant, rid, "doc/a").is_some(), "folder -> index.html");
    assert!(t.blobs.site_file(target.tenant, rid, "../../etc/passwd").is_none());
    // revocation of the permission: the ticket stops working
    set_grant(&t, &anna, rid, "user", bruno.user.user_id, None).await.unwrap();
    assert_eq!(content::resolve_ticket(&t, &token).await.unwrap_err().kind, Kind::Forbidden);
    // logout: the tickets of the session expire
    let tk2 = content::ticket(&t, &anna, SITES, rid, false).await.unwrap();
    let token2 = tk2.url.split("/c/").nth(1).unwrap().split('/').next().unwrap().to_string();
    mosaikit_kernel::identity::logout(&t, &anna.user).await.unwrap();
    assert!(content::resolve_ticket(&t, &token2).await.is_err());
    let _ = Value::Null;
}

#[tokio::test]
async fn files_and_content_permission_required() {
    let (t, _g, anna, _b) = setup().await;
    assert_eq!(files::list(&t, &anna, NOTES, None).await.unwrap_err().kind, Kind::Forbidden);
    let rid = note(&t, &anna, "x").await;
    assert_eq!(content::upload_site(&t, &anna, NOTES, rid, &[]).await.unwrap_err().kind, Kind::Forbidden);
}

#[tokio::test]
async fn guessing_the_password_of_a_link_is_limited() {
    let (t, _g, anna, _b) = setup().await;
    let rid = note(&t, &anna, "protected").await;
    let lp = links::create(&t, &anna, rid, None, Some("secret1")).await.unwrap();
    let r = links::resolve(&t, &token_of(&lp.url)).await.unwrap();
    for _ in 0..10 {
        assert!(!links::check_password(&t, &r, "wrong").await.unwrap());
    }
    // the link waits: even the right password is not checked any more for a while
    assert_eq!(links::check_password(&t, &r, "secret1").await.unwrap_err().kind, Kind::TooMany);
}

#[tokio::test]
async fn folder_served_as_a_tree() {
    let (t, _mgr, anna, bruno) = setup().await;
    let root = files::mkdir(&t, &anna, FILES, None, "tiles").await.unwrap();
    let sub = files::mkdir(&t, &anna, FILES, Some(root.id), "0").await.unwrap();
    files::upload(&t, &anna, FILES, Some(root.id), "tileset.json", b"{}", false).await.unwrap();
    files::upload(&t, &anna, FILES, Some(sub.id), "a.b3dm", b"tile", false).await.unwrap();
    files::upload(&t, &anna, FILES, None, "outside.txt", b"x", false).await.unwrap();

    let ctx = |c: &Caller| mosaikit_db::Ctx::user(c.user.user_id, c.tenant.tenant_id);
    let find = |c: &Caller, rel: &'static str| {
        let (t, ctx) = (&t, ctx(c));
        async move { files::resolve_path(t, FILES, &ctx, root.id, rel).await.unwrap() }
    };
    assert_eq!(find(&anna, "tileset.json").await.unwrap().name, "tileset.json");
    assert_eq!(find(&anna, "0/a.b3dm").await.unwrap().name, "a.b3dm");
    // a folder, a missing file, an empty path and unsafe paths lead nowhere
    for rel in [
        "",
        "0",
        "0/",
        "missing.json",
        "0/missing",
        "../outside.txt",
        "0/../tileset.json",
        "./tileset.json",
        "/tileset.json",
        "0//a.b3dm",
        r"0\a.b3dm",
    ] {
        assert!(find(&anna, rel).await.is_none(), "{rel:?}");
    }
    // somebody who does not see the folder finds nothing; with a grant on the folder, everything below it
    assert!(find(&bruno, "tileset.json").await.is_none());
    set_grant(&t, &anna, root.id, "user", bruno.user.user_id, Some(Level::Read)).await.unwrap();
    assert!(find(&bruno, "0/a.b3dm").await.is_some());
    set_grant(&t, &anna, root.id, "user", bruno.user.user_id, None).await.unwrap();
    assert!(find(&bruno, "0/a.b3dm").await.is_none(), "revoked");

    // the ticket of a folder is the address of its root: the caller adds the path
    let tk = content::ticket(&t, &anna, FILES, root.id, false).await.unwrap();
    assert!(tk.url.ends_with('/'), "{}", tk.url);
    let token = tk.url.split("/c/").nth(1).unwrap().split('/').next().unwrap().to_string();
    let target = content::resolve_ticket(&t, &token).await.unwrap();
    assert_eq!((target.kind.as_str(), target.plugin_id.as_str()), ("folder", FILES));

    // a public link on the folder sees the same tree and nothing outside it
    let l = links::create(&t, &anna, root.id, None, None).await.unwrap();
    let r = links::resolve(&t, &token_of(&l.url)).await.unwrap();
    assert!(files::resolve_path(&t, FILES, &r.ctx(), root.id, "0/a.b3dm").await.unwrap().is_some());
    assert!(files::resolve_path(&t, FILES, &r.ctx(), root.id, "../outside.txt").await.unwrap().is_none());
}

#[tokio::test]
async fn unzip_into_files() {
    let (t, _mgr, anna, bruno) = setup().await;
    let zip = zip_of(&[
        ("tileset.json", b"{}"),
        ("tiles/0/a.b3dm", b"tile"),
        ("tiles/0/b.b3dm", b"tile2"),
        ("__MACOSX/._tileset.json", b"junk"),
        ("tiles/._x", b"junk"),
    ]);
    let names = |l: files::Listing| l.entries.iter().map(|e| e.name.clone()).collect::<Vec<_>>();

    // into a new folder
    let r = files::unzip(&t, &anna, FILES, None, Some("city"), &zip, files::OnConflict::Fail).await.unwrap();
    let city = r.folder.unwrap();
    assert_eq!((r.files, r.skipped), (3, 0));
    assert_eq!(r.folders, 3, "city, tiles, 0");
    assert_eq!(names(files::list(&t, &anna, FILES, Some(city.id)).await.unwrap()), ["tiles", "tileset.json"]);
    let ctx = mosaikit_db::Ctx::user(anna.user.user_id, anna.tenant.tenant_id);
    assert!(files::resolve_path(&t, FILES, &ctx, city.id, "tiles/0/b.b3dm").await.unwrap().is_some());
    assert!(files::resolve_path(&t, FILES, &ctx, city.id, "__MACOSX/._tileset.json")
        .await
        .unwrap()
        .is_none());

    // the folder name is taken: nothing is created (fail), or the content goes in (skip / replace)
    let again = files::unzip(&t, &anna, FILES, None, Some("city"), &zip, files::OnConflict::Fail).await;
    assert_eq!(again.unwrap_err().kind, Kind::Conflict);
    let skip =
        files::unzip(&t, &anna, FILES, None, Some("city"), &zip, files::OnConflict::Skip).await.unwrap();
    assert_eq!((skip.files, skip.skipped), (0, 3));
    let rep =
        files::unzip(&t, &anna, FILES, None, Some("city"), &zip, files::OnConflict::Replace).await.unwrap();
    assert_eq!((rep.files, rep.skipped), (3, 0));

    // into the folder itself, a name already taken stops the whole thing and undoes what was made
    let more = zip_of(&[("new/x.txt", b"x"), ("tileset.json", b"other")]);
    let err = files::unzip(&t, &anna, FILES, Some(city.id), None, &more, files::OnConflict::Fail).await;
    assert_eq!(err.unwrap_err().kind, Kind::Conflict);
    assert_eq!(names(files::list(&t, &anna, FILES, Some(city.id)).await.unwrap()), ["tiles", "tileset.json"]);

    // unsafe or invalid archives are refused before anything is created
    for evil in [
        zip_of(&[("../outside.txt", b"x")]),
        zip_of(&[("/abs.txt", b"x")]),
        zip_of(&[("C:/win.txt", b"x")]),
        zip_of(&[("ok.txt", b"x"), ("a/../../b.txt", b"x")]),
    ] {
        let e = files::unzip(&t, &anna, FILES, None, Some("evil"), &evil, files::OnConflict::Fail).await;
        assert_eq!(e.unwrap_err().kind, Kind::BadRequest);
    }
    assert!(files::unzip(&t, &anna, FILES, None, None, b"not a zip", files::OnConflict::Fail).await.is_err());
    assert!(!names(files::list(&t, &anna, FILES, None).await.unwrap()).contains(&"evil".to_string()));

    // write permission on the destination is required
    assert!(files::unzip(&t, &bruno, FILES, Some(city.id), None, &zip, files::OnConflict::Fail)
        .await
        .is_err());
}

#[tokio::test]
async fn upload_in_pieces() {
    let (t, _mgr, anna, bruno) = setup().await;
    let begin = |name: &'static str, size: u64, replace: bool| {
        uploads::begin(&t, &anna, FILES, None, name, size, replace)
    };

    let up = begin("big.bin", 10, false).await.unwrap();
    assert_eq!((up.received, up.size), (0, 10));
    assert_eq!(uploads::chunk(&t, &anna, FILES, up.id, 0, b"abcde").await.unwrap().received, 5);
    // a piece sent twice or out of order says how far the upload is
    let again = uploads::chunk(&t, &anna, FILES, up.id, 0, b"abcde").await.unwrap_err();
    assert_eq!((again.kind, again.code()), (Kind::Conflict, "upload_offset"));
    assert!(again.message.contains("5 bytes"), "{}", again.message);
    assert_eq!(uploads::status(&t, &anna, FILES, up.id).await.unwrap().received, 5);
    // not finished, nothing in Files yet, and nobody else may continue it
    assert_eq!(uploads::finish(&t, &anna, FILES, up.id).await.unwrap_err().code(), "upload_incomplete");
    assert!(files::list(&t, &anna, FILES, None).await.unwrap().entries.is_empty());
    assert_eq!(uploads::chunk(&t, &bruno, FILES, up.id, 5, b"x").await.unwrap_err().kind, Kind::NotFound);
    assert_eq!(
        uploads::chunk(&t, &anna, FILES, up.id, 5, b"fghijk").await.unwrap_err().kind,
        Kind::BadRequest
    );
    assert_eq!(uploads::chunk(&t, &anna, FILES, up.id, 5, b"fghij").await.unwrap().received, 10);

    let e = uploads::finish(&t, &anna, FILES, up.id).await.unwrap();
    assert_eq!((e.name.as_str(), e.size), ("big.bin", 10));
    assert_eq!(files::read(&t, &anna, FILES, e.id).await.unwrap().1, b"abcdefghij");
    assert_eq!(uploads::status(&t, &anna, FILES, up.id).await.unwrap_err().kind, Kind::NotFound, "consumed");

    // what an upload would be refused for comes before the bytes
    assert_eq!(begin("big.bin", 3, false).await.unwrap_err().kind, Kind::Conflict);
    assert_eq!(begin("a/b", 3, false).await.unwrap_err().kind, Kind::BadRequest);
    assert_eq!(begin("zero", 0, false).await.unwrap_err().kind, Kind::BadRequest);
    // replacing keeps the file and changes its content
    let again = begin("big.bin", 3, true).await.unwrap();
    uploads::chunk(&t, &anna, FILES, again.id, 0, b"xyz").await.unwrap();
    let e2 = uploads::finish(&t, &anna, FILES, again.id).await.unwrap();
    assert_eq!(e2.id, e.id);
    assert_eq!(files::read(&t, &anna, FILES, e.id).await.unwrap().1, b"xyz");

    // an upload thrown away is gone; a person has a few open at a time
    let gone = begin("gone", 5, false).await.unwrap();
    uploads::abort(&t, &anna, FILES, gone.id).await.unwrap();
    assert_eq!(uploads::status(&t, &anna, FILES, gone.id).await.unwrap_err().kind, Kind::NotFound);
    for i in 0..8 {
        uploads::begin(&t, &anna, FILES, None, &format!("open{i}"), 5, false).await.unwrap();
    }
    assert_eq!(begin("one-more", 5, false).await.unwrap_err().kind, Kind::TooMany);
}
