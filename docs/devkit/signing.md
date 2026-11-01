# Developer signing

How a plugin author gets a signing key, how an Administrator trusts it, and what to do when a key is lost or leaks.
The package format and the trust check are in [Packaging and signing](packaging.md); this page is the procedure.

## 1. Make a key (the developer)

```
mosaikit-plugin keygen --out publisher.key
```

The command writes the private key to `publisher.key` (it never overwrites a file) and prints the **public key**, a
base64 ed25519 key. Send the public key to the Administrators who will install your plugins; never send the private
one. Keep `publisher.key` outside every repository. A copy in a password manager or an offline store is your only
backup: a lost key cannot be recovered, only replaced (section 4).

For CI, put the base64 of the private key in a secret named `MOSAIKIT_SIGNING_KEY` and run `mosaikit-plugin pack`: it
signs with that variable. Without a variable or `--key`, the tool uses a development key it makes once per user: good
for your own test server, which trusts it in the developer profile, and nowhere else.

## 2. Sign

```
mosaikit-plugin pack --key publisher.key       # builds, validates and signs dist/<id>-<version>.mskp
mosaikit-plugin sign dist/x.mskp --key publisher.key --out dist/x.signed.mskp   # sign again, or sign an unsigned package
mosaikit-plugin validate dist/x.mskp           # checks the package and its signature
```

## 3. Trust a publisher (the Administrator)

A production server installs only packages signed with a key it trusts. The Administrator adds the publisher's public
key to the configuration and restarts the server:

```toml
# mosaikit.toml
trusted_keys = ["<key of the official packages>", "<public key of the publisher>"]
```

or, in Docker, `MOSAIKIT_TRUSTED_KEYS="key1,key2"` in the `.env` file. Before adding a key check that it comes from the
publisher through another channel than the package itself (a call, the publisher's site): the key is the whole trust.
Keep the key of the official packages in the list, or the plugins of the release stop installing.

Then install the `.mskp` (Plugins > Install from a file). A package signed with another key is refused with
`publisher key not trusted: <key>`; an unsigned one with `unsigned package`.

## 4. Revoke a publisher or a key

| Case | What to do |
|---|---|
| The publisher is no longer trusted, or the key leaked | Remove the key from `trusted_keys` and restart. New installs and updates signed with it are refused. What is already installed is not removed: uninstall it (Plugins), or block its versions with the `blocklist` of the registry `index.json` |
| One version is bad | Add it to the `blocklist` of the registry (an entry with the `id`, the `version` and a `reason`), and publish a fixed version |
| The key is lost | Make a new key (section 1), ask the Administrators to add the new public key, publish the plugins again signed with it (same `id`, a higher `version`), then remove the old key |
| The key is rotated on schedule | Add the new key, publish the next versions with it, remove the old key when no installed plugin needs an update from it |

A trusted key list that only grows is a risk: review it when a developer leaves.

## The key of the kit

The archives of the kit are signed with the key of the official packages. Its public key is in the file
`trusted_key.txt` of the kit, and `mosaikit-plugin self-update` refuses a release that is not signed by a trusted key
(see [Releasing the kit](releasing.md)). It is not a publisher key for your plugins.
