### Fixed

- Storing a file from the Java code of an extension whose transaction was already marked for rollback
  failed with 500 "Syncs are not allowed" from the transaction manager (#93): `FileStorage.store`
  now refuses it at once with `IllegalStateException`, leaving nothing in the store, and
  `FileStorage.delete` leaves the file, as the rollback does (MK-041).
