### Added

- Administrators create local accounts for people (MK-048, #101): the administrators of an
  organization for theirs, the platform administrators for any. The person chooses the password with
  a link that works once, for `mosaikit.accounts.set-password-valid-for` (7 days): mailed when the
  installation sends mail, otherwise shown once in **Permissions** > **People** with a button that
  copies it, so that an installation without a mail server can onboard people. A new link replaces
  the previous one; creating the account and issuing and using the link are audited. The kernel
  sends mail only when `quarkus.mailer.host` is set, and the README of each distribution shows how
  to set the mail server.
