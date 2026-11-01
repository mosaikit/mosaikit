# mosaikit-sql-guard

The whitelist of SQL statements that Mosaikit plugins may run, at run time and in migrations: it parses the text
(`check_query`, `check_migration`) and refuses what is not allowed (other schemas, administration statements,
irreversible changes in a migration).

It is the library behind `mosaikit-plugin validate` and the Mosaikit server: a plugin that passes the check here is
accepted by the server's own check, because it is the same code.

Install the command-line tool, not this crate: `cargo install mosaikit-plugin-cli`.

Licence: Apache-2.0. Changes: [CHANGELOG.md](CHANGELOG.md).
