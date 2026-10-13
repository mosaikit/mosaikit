# Mosaikit portable

Runs on this computer without installing Java, PostgreSQL or containers, for one organization.

| | |
|---|---|
| **Start** | Windows: double-click `mosaikit.cmd`. Linux, macOS: `./mosaikit` |
| **Open** | <http://localhost:8080>. At the first start sign in as `admin` with the password in `data/initial-admin-password.txt` |
| **Stop** | Ctrl+C in the window of Mosaikit (answer *N* if Windows asks to terminate the batch job). The database stops with it |
| **Extensions** | Copy the extension package (`<name>.zip`) into `extensions/` as it is and start Mosaikit again |
| **Backup** | Stop Mosaikit and copy `data/`. To restore, put the copy back in place |
| **Settings** | `config/application.properties` |

Extensions with Java code are loaded by rebuilding the kernel at the next start, which takes a few
seconds; if the kernel cannot start with a new extension, the extension is rolled back and Mosaikit
starts with the previous extensions.

## Settings

The settings of Mosaikit and of the installed extensions are in `config/application.properties`; for
example, an extension whose documentation names the setting `example.reports.endpoint`:

```properties
example.reports.endpoint=https://reports.example.org
```

An environment variable wins over the file: the name of the setting in upper case, with every
character that is not a letter or a digit replaced by `_` (`EXAMPLE_REPORTS_ENDPOINT`). Start
Mosaikit again after a change.

## Contents

| Path | Content |
|---|---|
| `mosaikit`, `mosaikit.cmd` | the launcher |
| `config/` | settings |
| `data/` | the database, the files of extensions (`data/files/`) and the generated passwords, created at the first start |
| `extensions/` | installed extensions |
| `bin/` | the kernel, the Java runtime, PostgreSQL and their licenses |

More: <https://github.com/mosaikit/mosaikit>
