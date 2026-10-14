### Added

- An **Accounts** page in the console for platform administrators (MK-125): it finds an account by
  its email address, shows whether it is suspended, since when, by whom and why, suspends it with a
  reason and reinstates it, and lists the suspended accounts. The suspension takes an optional
  reason, `{"reason": "…"}`, kept with the account until it is reinstated and in the audit log;
  `GET /api/v1/platform/accounts/{email}/suspension` and `GET /api/v1/platform/accounts/suspended`
  read them.
