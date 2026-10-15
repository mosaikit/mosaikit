# Credentials of external services

An extension that calls an external service, such as a model provider, a mail server or a
database, does not keep its key in a document, a setting or the code: the administrators of the
organization store it in **Credentials**, encrypted by the kernel (MK-062, see
[administration](../../guide/administration.md#credentials-of-extensions)), and the backend reads it
by name with the `Secrets` bean of `kernel-api`, on the server, at the moment of the call:

```java
@Inject
Secrets secrets;

String summarize(String text) {
    try (SecretValue key = secrets.require("org.example.reports", "model-provider")) {
        return client.post(text, "Bearer " + key.reveal());
    }
}
```

- The extension names itself in every call, as with `Notifications.send`; the kernel refuses a name
  that is not an active extension with `IllegalArgumentException`.
- It reads the credentials of the organization of the request only. A credential that the
  administrators meant for one extension is read by that extension only; one meant for none, by
  every extension of the organization. `find` answers empty, and `require` throws
  `NoSuchElementException` naming the credential, when there is none it may read.
- `SecretValue` never shows the value in `toString`. Take it with `chars()`, `bytes()` or, for APIs
  that take only strings, `reveal()`, where the call needs it, and close it when done. Never return
  it to the browser, write it into a document or put it in a log or an error message.
- `SecretsUnavailableException` (answered with 503) means that the installation has no master key,
  or that the credential does not decrypt with its keys. Catching it leaves the transaction of the
  request usable (see [Transactions](transactions.md#transactions-and-the-beans-of-the-kernel)): an extension can go
  on without the credential, such as on an installation without a master key.
- Every read is in the audit log of the organization (`secrets.read`, channel `EXTENSION`), with the
  name of the credential and the extension, never the value.
- Tell the administrators in the documentation of the extension which names it reads, and of which
  kind.

## Credentials of the installation

Some credentials belong to no organization: the account of a server shared by the whole
installation, a mail relay, a licence key. Platform administrators keep them in **Installation
credentials** (MK-127). `resolve` reads the most specific credential with a name: the one of the
organization of the request when the extension may read it, otherwise the one of the installation;
outside any organization, such as in a scheduled job or a request without one, the one of the
installation only. `find` and `require` keep to the organization, as before.

```java
Optional<SecretValue> relay = secrets.resolve("org.example.reports", "mail-relay");
```

The same rules apply: a credential of the installation meant for one extension is read by that
extension only, values stay on the server, and every read is audited, a credential of the
installation in the audit log of the platform (`secrets.read`, with `scope` `installation` and the
organization of the request, if any). An organization that stores a credential with the same name
replaces the one of the installation for itself: document which names may be set at either level.
