# Mosaikit portable

Runs on this computer without installing Java, PostgreSQL or containers, for one organization.

| | |
|---|---|
| **Start** | Windows: double-click `mosaikit.cmd`. Linux, macOS: `./mosaikit` |
| **Open** | <http://localhost:8080>. At the first start sign in as `admin` with the password in `data/initial-admin-password.txt` |
| **Stop** | Ctrl+C in the window of Mosaikit (answer *N* if Windows asks to terminate the batch job). The database stops with it |
| **Plugins** | Copy the plugin package (`<name>.zip`) into `plugins/` as it is and start Mosaikit again |
| **Backup** | Stop Mosaikit and copy `data/`. To restore, put the copy back in place |
| **Settings** | `config/application.properties` |

Plugins with Java code are loaded by rebuilding the kernel at the next start, which takes a few
seconds; if the kernel cannot start with a new plugin, the plugin is rolled back and Mosaikit
starts with the previous plugins.

## Contents

| Path | Content |
|---|---|
| `mosaikit`, `mosaikit.cmd` | the launcher |
| `config/` | settings |
| `data/` | the database and the generated passwords, created at the first start |
| `plugins/` | installed plugins |
| `bin/` | the kernel, the Java runtime, PostgreSQL and their licenses |

More: <https://github.com/mosaikit/mosaikit>
