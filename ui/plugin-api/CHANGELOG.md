# Changelog of @mosaikit/plugin-api

Versions follow the plugin API: see `docs/architecture.md` §8.11 of Mosaikit. A deprecated item stays for one major
version and is removed in the next.

## 1.0.0

First version of the plugin API (API 1).

- `API_VERSION`, `Hello.api`, `msk.api`, `checkHostApi`, `isIncompatible` and the error code `incompatible_api`:
  the version handshake between the plugin and the shell.
- `ErrorCode`: the codes of the errors, typed; `BridgeError.code` and `BridgeReply.code` use it. An error raised
  by the logic with a code of its own (`Error::coded` in the SDK) arrives with that code.
- `HostEvents` and `HostEventName` type the events of the host; the `theme` event is deprecated (use `context`).
- `ResourceMeta` types `msk.resource`.
- `ItemCtx.lang` and `EditorCtx.lang` are `string` (a language plugin may add any language); the column labels of
  a board receive it too.
- `ArtName` is limited to the pictures of the plugins (`documents`, `maps`, `notes`, `tasks`, `contacts`, `apps`,
  `generic`).
- The exports are listed one by one. No longer exported: `Bridge` (the type stays for tests), `applyTheme`,
  `applyContext`, `emptyArt`, `initials`, `errorText` (use `errText`) and the wire types (`BridgeRequest`,
  `BridgeReply`, `BridgeEvent`, `isReply`, `isEvent`).
- `el` lives in its own module.
- The package is no longer `private`: own version, `files`, `README.md` and `CHANGELOG.md`.
