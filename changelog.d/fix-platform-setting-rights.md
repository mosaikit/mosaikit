### Security

- The request role, as which every request and the SQL of extensions run (ADR-0018), could insert,
  change and delete the tables of the installation that have neither row-level security nor an
  organization, such as the settings of the platform, accounts, sessions, access keys, service
  identities, organizations and the levels of sharing: a statement of an extension could, for
  example, turn self-registration back on or change the levels that decide who reads a shared
  resource. It may now only read them; the kernel writes them as the owner (MK-019).
