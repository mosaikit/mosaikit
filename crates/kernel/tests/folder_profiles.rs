//! `[[folder_profiles]]`: a plugin says what kind of folder it knows by the names at its root; the kernel tells
//! the person when a zip they unpack looks like one.

use std::collections::BTreeMap;
use std::io::Write;

use mosaikit_kernel::notify::{self, Filter};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{files, profiles};

const FILES: &str = "com.mosaikit.files";
const GEO: &str = "com.test.geo";

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default();
    for (name, data) in entries {
        w.start_file(*name, opts).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

async fn install_geo(t: &TestKernel) {
    let toml = format!(
        "id = \"{GEO}\"\nname = \"Geo\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Geo data\"\n\
         [[folder_profiles]]\nid = \"tiles3d\"\nlabel = \"3D Tiles dataset\"\nmarkers = [\"tileset.json\"]\n\
         [i18n.it.folder_profiles]\ntiles3d = \"dataset 3D Tiles\"\n"
    );
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml.into_bytes());
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

#[tokio::test]
async fn an_unpacked_folder_is_recognised_and_announced() {
    let t = start().await;
    t.install("files").await;
    install_geo(&t).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let (anna, bruno) = (t.home(&anna).await, t.home(&bruno).await);
    let fail = files::OnConflict::Fail;

    // the marker at the root, in any case
    let z = zip_of(&[("TILESET.JSON", b"{}"), ("tiles/a.b3dm", b"x")]);
    let r = files::unzip(&t, &anna, FILES, None, Some("city"), &z, fail).await.unwrap();
    let city = r.folder.unwrap();
    assert_eq!(r.suggestions.len(), 1);
    let s = &r.suggestions[0];
    assert_eq!(
        (s.plugin.as_str(), s.profile.as_str(), s.label.as_str()),
        (GEO, "tiles3d", "3D Tiles dataset")
    );
    assert_eq!((s.folder, s.marker.as_str()), (city.id, "TILESET.JSON"));
    assert_eq!(s.labels["it"], "dataset 3D Tiles");
    assert_eq!(s.at, format!("profile/tiles3d/{}?source={FILES}", city.id));
    assert!(s.link.starts_with("#/t/alfa/p/com.test.geo/profile%2Ftiles3d%2F"), "{}", s.link);
    // the bell has it, with a link that opens the plugin at that place
    let bell = notify::list(&t, &anna.user, &Filter::default()).await.unwrap();
    let n = bell.items.iter().find(|n| n.source == GEO).expect("a notification of the plugin");
    assert!(n.title.contains("city") && n.title.contains("3D Tiles dataset"), "{}", n.title);
    assert_eq!(n.link, s.link);
    assert_eq!(n.data["labels"]["it"], "dataset 3D Tiles", "the bell translates the label");

    // a zip with one folder around everything: the folder that holds the marker is the inner one
    let z = zip_of(&[("data/tileset.json", b"{}"), ("data/t/0.b3dm", b"x")]);
    let r = files::unzip(&t, &anna, FILES, None, Some("wrapped"), &z, fail).await.unwrap();
    let inner = files::list(&t, &anna, FILES, Some(r.folder.unwrap().id)).await.unwrap().entries[0].id;
    assert_eq!(r.suggestions.len(), 1);
    assert_eq!((r.suggestions[0].folder, r.suggestions[0].marker.as_str()), (inner, "tileset.json"));

    // nothing that looks like a dataset: no suggestion and no notification
    let before = notify::list(&t, &anna.user, &Filter::default()).await.unwrap().items.len();
    let z = zip_of(&[("readme.txt", b"x"), ("a/tileset.json", b"{}"), ("b/x", b"x")]);
    let r = files::unzip(&t, &anna, FILES, None, Some("plain"), &z, fail).await.unwrap();
    assert!(r.suggestions.is_empty(), "two folders and no marker at the root");
    assert_eq!(notify::list(&t, &anna.user, &Filter::default()).await.unwrap().items.len(), before);

    // unpacking into a folder that already exists looks at that folder; a zip of one plain file does not announce
    let z = zip_of(&[("tileset.json", b"{}")]);
    let r =
        files::unzip(&t, &anna, FILES, Some(city.id), None, &z, files::OnConflict::Replace).await.unwrap();
    assert_eq!(r.suggestions.len(), 1);

    // on demand, for any folder the person sees; somebody who does not see it finds nothing
    assert_eq!(profiles::detect(&t, &anna, FILES, city.id).await.unwrap().len(), 1);
    assert!(profiles::detect(&t, &bruno, FILES, city.id).await.unwrap().is_empty());
}
