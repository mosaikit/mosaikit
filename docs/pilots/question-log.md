# Pilot log

One row per stumble. Keep the first column in the order it happened.

| # | Pilot (8/14) | Time | Step | What the person tried | What we answered | Fix (document or tool) | Done |
|---|---|---|---|---|---|---|---|
| 1 | 8 | 2026-11-09 | Start: what to read after the download | Opened the kit; `KIT.txt` only said to set an environment variable | | README.md at the root of the kit with the five steps and where to read; START HERE in `KIT.txt` (PR 251) | yes |
| 2 | 8 | 2026-11-09 | Download | Had no link to the release and did not know where the archive is | | Link to the releases page and the Assets list in getting-started (PR 257) | in the queue |
| 3 | 8 | 2026-11-09 | Install the kit | Set only `MOSAIKIT_KIT`: the commands were not found | | `bin/` on `PATH` is required; commands for Windows, Linux and macOS; README.md and KIT.txt say it (PR 257) | in the queue |
| 4 | 8 | 2026-11-09 | Make a plugin | Typed `--kit /path/to/kit` as written in the guide; `dev` failed later on `C:\path	o\kit\sdk` | | `new` refuses a folder that is not a kit; the guide shows a placeholder (PR 252) | yes |
| 5 | 8 | 2026-11-09 | After `new` | The tool said `build && pack`, the guide said `dev` | | The tool now says `cd <folder> && mosaikit-plugin dev` (PR 252) | yes |
| 6 | 8 | 2026-11-09 | Change something | Added the field `due` as the guide said: `test` failed with `[i18n.it] is incomplete` | | The guide says to translate the field; the error says where to add the text; troubleshooting entry (PR 252) | yes |
| 7 | 8 | 2026-11-09 | Change something | No example for a hook or for the options of `mountCrud` | | Examples in getting-started (PR 257) | in the queue |
| 8 | 8 | 2026-11-09 | Run the plugin | The form of a new item had no fields; the Manifest panel of the developer tools stayed on Loading | | Not reproduced (the API returned the fields on `dev`, on an installed package and on the Docker kit). Asked the person to retry after the i18n fix and to send the console and the request | open |
| 9 | 8 | 2026-11-09 | Install | Typed `install dist/<file>.mskp` as written; later `install` with no server (os error 10061) | | The guide names the real file; the error says to start `dev` or the Docker kit; troubleshooting entry (PR 252, 256) | yes |
| 10 | 8 | 2026-11-09 | Install | `install` refused the plugin that `dev` runs (development mode); removing it in the web page did not last | | The `.mskp` goes to another server: the Docker kit, section 6 of getting-started (PR 252). Why the web uninstall does not last is not explained in the guide | open |
| 11 | 8 | 2026-11-09 | Docker kit | `docker compose up -d`: the image answered `denied` | | The image of the kit was never published: the workflow of the kit pushes it now (PR 253); an owner made the package public | yes |
| 12 | 8 | 2026-11-09 | Docker kit | The log shows `ERROR development plugin /plugin: No such file or directory` at start | | Harmless (the empty plugin folder of the kit) but it looks like a failure: to be silenced or explained in rc3 | open |
| 13 | 8 | 2026-11-09 | Check the key | `install` with a key that is not trusted succeeded on the Docker kit | | The developer profile accepted any key: `MOSAIKIT_DEVELOPER_PROFILE_STRICT_SIGNATURES=1` and step 3 of section 6 (PR 256) | in the queue |
| 14 | 8 | 2026-11-09 | Steps 1 to 8 | Whole path to the plugin installed, turned on and used on the Docker kit | | Confirmed working by the person | yes |
