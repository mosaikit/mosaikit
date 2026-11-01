# Changelog e compatibilità

Versione inglese: [../changelog.md](../changelog.md).

## Le versioni in sintesi

Un solo numero di versione per tutto il kit, con il ritmo della piattaforma (decisione D6 del piano). I pacchetti che
portano la plugin API hanno anche una versione propria, con un changelog.

| Pezzo | Versione | Changelog |
|---|---|---|
| Mosaikit (piattaforma) | 1.0.0 | [CHANGELOG.it.md](../../../CHANGELOG.it.md) |
| Kit di sviluppo (`mosaikit-plugin`, questa documentazione) | 1.0.0 (la versione della piattaforma) | [crates/plugin-cli/CHANGELOG.md](../../../crates/plugin-cli/CHANGELOG.md) |
| Plugin API | 1 | architettura §8.11 |
| ABI della logica | 1 | architettura §8.3 |
| SDK `mosaikit-plugin-sdk` | 1.0.0 | [crates/plugin-sdk/CHANGELOG.md](../../../crates/plugin-sdk/CHANGELOG.md) |
| Pacchetto UI `@mosaikit/plugin-api` | 1.0.0 | [ui/plugin-api/CHANGELOG.md](../../../ui/plugin-api/CHANGELOG.md) |
| Helper di test `@mosaikit/plugin-testing` | 1.0.0 | [ui/plugin-testing/CHANGELOG.md](../../../ui/plugin-testing/CHANGELOG.md) |
| Formato del pacchetto `.mskp` | 3 | architettura §8.5 |
| Manifesto | v3 | [Riferimento del manifesto](manifest.md) |

## Quali versioni funzionano insieme

| Plugin costruito per | Piattaforma | SDK | Pacchetto UI | Risultato |
|---|---|---|---|---|
| plugin API 1, `[requires] mosaikit = ">=1.0, <2"` | 1.x | 1.x | 1.x | funziona |
| plugin API 1 | 1.x | 1.x più nuova | 1.x più nuovo | funziona: una minor aggiunge, una patch corregge |
| plugin API 2 | 1.x | | | rifiutato: `plugin_incompatible` (la piattaforma parla l'API 1) |
| plugin API 1 | una piattaforma che parla l'API 2 | | | l'host parla ogni API fino alla propria, quindi continua a funzionare |
| un pacchetto UI più nuovo dell'API della shell | shell più vecchia | | | `incompatible_api`, la pagina può mostrare un messaggio suo |
| nessun `[requires]` | qualsiasi | | | funziona su ogni versione: un avviso, e nessuna protezione all'aggiornamento |

Regole:

- Un plugin dichiara `[requires] mosaikit` (un intervallo) e `api` (un intero). Il kernel rifiuta un plugin fuori
  dall'intervallo o costruito per un'altra API, con un solo errore che nomina entrambi ([Risoluzione dei problemi](troubleshooting.md)).
- La plugin API è un intero che cresce solo con una modifica incompatibile. Una release di Mosaikit che la cambia alza
  insieme SDK e pacchetto UI. L'host parla ogni API fino alla propria; un plugin costruito per una più nuova è rifiutato con
  `incompatible_api`; un host o un plugin anteriore all'handshake conta come API 1.
- Un kernel che non conosce `[requires]` rifiuta il manifesto (le chiavi sconosciute sono rifiutate): rilasciare il kernel
  che legge una chiave prima del primo plugin che la usa.
- Costruire la logica con l'SDK della versione maggiore dell'API che si dichiara, e fissare il pacchetto UI con `^1.0.0`.

## Regola di deprecazione

Un elemento deprecato (chiave del manifesto, funzione dell'SDK, export della UI o evento) **resta per una versione
maggiore** dell'API, è marcato `@deprecated` (o `#[deprecated]`) con ciò che lo sostituisce, scrive un avviso in sviluppo
dove può (il kernel lo fa per le chiavi del manifesto), compare nel changelog del suo pacchetto, ed è rimosso nella
versione maggiore successiva.

### Deprecato nell'API 1

| Elemento | Sostituire con | Rimosso in |
|---|---|---|
| chiave del manifesto `abi` | `[requires] api` | API 2 |
| chiave del manifesto `min_kernel` | `[requires] mosaikit = ">=1.2, <2"` | API 2 |
| l'evento `theme` | `context` (`msk.onContext`) | API 2 |
| la `[contribution]` con emoji (ora facoltativa) | `name` e `icon` | API 2 |

## Sperimentale nell'API 1

Parte della superficie ha test del kernel ma ancora nessun plugin d'esempio ufficiale, quindi l'API 1 **non** promette che
resti com'è finché un esempio (o un template del kit) non la usa. Una modifica a uno di questi elementi è annunciata nel
changelog del pacchetto, con la regola di deprecazione applicata quando una distribuzione vi si appoggia. Sperimentali:

- `[[config]]` e `ctx.setting`
- `[[user_permissions]]` e `ctx.can`
- `[permissions] calls` e `plugin.call` (`ctx.call_plugin`)
- `ctx.notify` e `msk.notify`
- `network` e `http.fetch`
- `script_eval`
- `[search]`
- le azioni `command` di un'estensione
- `CrudOptions.panel`
- `Resources::create` e `Resources::delete` dell'SDK (`resource.create`, `resource.delete`)
- `msk.web` (permesso `web`)

L'esempio `insights` ora usa `[search]` e `note-priority` le azioni `set` di un'estensione; l'architettura §8.11 li elenca
ancora come sperimentali finché il proprietario non li toglie dall'elenco (una decisione per una release, non per questi
documenti).

## Modifiche per pacchetto

Leggere il changelog di ogni pacchetto quando si aggiorna. In breve, per la prima release:

- **SDK 1.0.0** — `Error` è una struct con un codice (`Error::coded`); `Ctx` è `#[non_exhaustive]`; `abi`, `Registry` sono
  `#[doc(hidden)]`; `Values::bool` legge `true`, `1`, `yes`. Non rilasciato: `Ctx::files()` (richiede `files_read`); gli
  errori dell'host tengono il loro `code`.
- **`@mosaikit/plugin-api` 1.0.0** — l'handshake di versione (`API_VERSION`, `msk.api`, `isIncompatible`), `ErrorCode`
  tipizzato, `HostEvents`, export espliciti (`Bridge`, `applyTheme`, `emptyArt`… non sono più esportati), `ResourceMeta`.
- **`mosaikit-plugin` 1.0.0** — `new` (varianti, esempi), `build`, `test`, `validate --strict`, `pack`, `sign`, `keygen`,
  `install`, `doctor`, `dev`.
- **`@mosaikit/plugin-testing` 1.0.0** — `startDevServer`, `attachDevServer`, `signIn`, `openPlugin`, `createItem`, gli
  helper axe.

## Questa documentazione

Scritta per la plugin API 1 e il kit 1.0.0. Quando una release cambia l'API, questa pagina riceve una riga nelle tabelle
sopra, i documenti interessati cambiano e seguono le versioni italiane.
