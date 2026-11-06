# Costruire un'applicazione su Mosaikit

Un'**applicazione** (un *prodotto*, nel codice una *distribuzione*) è Mosaikit con un nome, un brand, una scelta di plugin
e un modo di avviarsi che sono tuoi. La costruisci dal Mosaikit **compilato** (il kit desktop e l'immagine Docker): niente
sorgenti di Mosaikit, niente fork, niente compilazione del kernel. Lo strumento è `mosaikit-product`.

Un esempio completo, passo per passo, è in [Prodotto di riferimento](../reference-product.md). I termini di ridistribuzione sono in
[Licenza e responsabilità](../product-licensing.md). Il contratto fra base e prodotto è in
[../../reports/distribution-audit.md](../../reports/distribution-audit.md). *(Traduzione a cura dell'autore: vuole la lettura di
un madrelingua.)*

## 1. Che cos'è un prodotto

| La base dà (non cambia mai) | Un prodotto aggiunge |
|---|---|
| Tenant, utenti, i tre ruoli, risorse, condivisione, link pubblici, KPI, ricerca, notifiche | Un nome, una versione e il nome dell'eseguibile |
| Le regole di sicurezza: CSP dei contenuti e dei plugin, sandbox della logica, row level security, SQL guard | Un brand: logo, icona, colori, testi della pagina di accesso |
| Il modello delle origini (origine dell'app e dei plugin) e il modello di firma dei pacchetti | I plugin della release: i propri e gli ufficiali che tiene |
| L'API dei plugin 1 e le sue regole di compatibilità | Valori predefiniti e impostazioni bloccate, lingue, il primo avvio, estensioni del database richieste |
| Il pacchetto desktop e Docker, le migrazioni della base | Semi (impostazioni dei plugin, chiavi), gruppi di navigazione, sidecar |

**Che cosa un prodotto non può cambiare:** il kernel, le regole di sicurezza, le origini, il modello di firma, l'API dei plugin, il
formato dei dati. Tutto ciò che può cambiare è nel rapporto di audit e si imposta in `distribution.toml`.

## 2. La cartella del prodotto

```text
acme-maps/
  distribution.toml      il prodotto: identità, plugin, valori predefiniti, primo avvio, estensioni
  branding/              brand.toml, logo, favicon, icona
  plugins/               i suoi plugin, una cartella autonoma ciascuno (mosaikit-plugin new <nome> --into plugins)
  shared/                codice usato da più plugin, per percorso
  tests/                 i suoi test
  .github/workflows/     CI
```

`mosaikit-product new acme-maps` la crea; `validate` la controlla; `dev` la avvia.

## 3. `distribution.toml`

```toml
[product]
id = "acme-maps"            # nomi dei file e immagine Docker: minuscole, cifre, '-'
name = "Acme Maps"          # mostrato agli utenti
version = "1.2.0"           # la tua versione, non quella di Mosaikit
base = ">=1.0, <2"          # le versioni della base con cui la release funziona
executable = "acme-maps"    # l'eseguibile desktop

[brand]
dir = "branding"

[plugins]
roots = ["plugins"]
include = ["com.acme.parcels", "com.mosaikit.notes"]   # i tuoi e gli ufficiali che tieni ("*" = tutti quelli delle radici)

[desktop]
database = "sqlite"         # oppure "postgres" (incorporato)
port = 48080

[docker]
image = "acme-maps"
postgres_image = "postgis/postgis:17-3.5-alpine"
```

## 4. Brand e identità

`branding/brand.toml`: `name`, `tagline`, `login_message`, `footer`, `support_url`, `logo`, `favicon`, `icon` (un `.ico` 16–256 px) e `[colors]`
(solo `#rrggbb`). I plugin ricevono gli stessi colori. `validate` controlla che i file esistano e che i colori siano `#rrggbb`.
Su **desktop** nome, versione e icona dell'eseguibile si scrivono con [`rcedit`](https://github.com/electron/rcedit) se è nel PATH (Windows);
senza, la build lo dice e lascia l'eseguibile com'è. Dati **About** (`[about]`, prodotto, versione, base): nel log all'avvio e in `GET /api/brand` (`about`).

## 5. Scegliere e scrivere i plugin

- **Plugin ufficiali**: per id in `include`, copiati con la loro firma dal registro della base. Un id che la base non ha è un errore. Non si fa il fork: per
  un altro comportamento si scrive un plugin di *estensione*.
- **Plugin propri**: in `roots`, ognuno un progetto autonomo (`mosaikit-plugin new`); `mosaikit-product validate` esegue i controlli strict su tutti. La release li
  firma con la chiave del prodotto.
- **Codice condiviso**: in `shared/`, per percorso.
- Un plugin dichiara `[requires] mosaikit`; `validate` rifiuta un plugin il cui intervallo non include la base.

## 6. Impostazioni, lingue e primo avvio

```toml
[defaults]                       # valori delle impostazioni della piattaforma al posto di quelli incorporati
"identity.welcome" = "Benvenuto in Acme Maps"

[locked]                         # impostazioni che nessuno può cambiare
keys = ["identity.name", "theme"]

[languages]                      # scorciatoia per lang.enabled e lang.default
enabled = ["en", "it"]
default = "it"

[bootstrap]                      # primo avvio (le variabili d'ambiente MOSAIKIT_INITIAL_TENANT, ... prevalgono)
tenant = "main"
tenant_name = "Acme Maps"
trial_days = 30
admin_email = "ops@acme.example"

[bootstrap.quota]                # facoltativo: le quote di quel tenant (una quota omessa è quella della piattaforma)
storage_mb = 5000
people = 50
items = 100000
```

La base si rifiuta di partire con una voce sbagliata e nomina la chiave. Un'impostazione bloccata ignora ciò che è memorizzato e tiene il valore del prodotto.
Nel profilo sviluppatore (`mosaikit-product dev`) il primo tenant di `[bootstrap]` non viene creato. `[bootstrap.quota]` imposta le quote del primo tenant (le quote proprie del tenant, come le imposterebbe
l'Amministratore dalla sua pagina); un numero negativo è un errore all'avvio, e il tenant si può cambiare poi come ogni altro. **Semi** (`[[plugin_settings]]`, `[[service_key_values]]`) per riferimento
(`env:NOME`, `file:PERCORSO`): mai un segreto nel file. I **dati iniziali** di un plugin sono un sidecar `kind = "oneshot"` idempotente.

## 7. Dati ed estensioni

- **Desktop**: SQLite oppure PostgreSQL incorporato. **Docker e Kubernetes**: PostgreSQL (`[docker] postgres_image` per PostGIS).
- **Estensioni richieste**: `[database] extensions = ["postgis"]`. All'avvio, su PostgreSQL, la base controlla che siano installate e si ferma con un messaggio che le nomina.
  `build desktop` rifiuta un prodotto che le chiede con SQLite.
- **Backup**: desktop, copia della cartella `data/` a programma fermo; Docker, i backup programmati dell'Amministratore e i volumi.

## 8. Build e release

```text
mosaikit-product build desktop --base <kit desktop>                          dist/<id>-<versione>-desktop
mosaikit-product build docker  --base <kit desktop> --base-image mosaikit:1.0.0 [--build]
mosaikit-product build k8s     --base-k8s <cartella k8s del kit>
```

La release non porta mai un plugin non firmato: la build verifica ogni pacchetto contro le chiavi che il server considererà fidate. Firma con `--key`,
`MOSAIKIT_SIGNING_KEY` o `MOSAIKIT_SIGNING_KEY_FILE` (senza, usa una chiave di sviluppo: mai da distribuire). Pubblica un `SHA256SUMS`.

## 9. Aggiornamenti

La release dichiara l'intervallo di base (`[product] base`); fuori intervallo il prodotto non parte e dice perché. Per passare a una base nuova: leggi il changelog del kit,
imposta l'intervallo, esegui `mosaikit-product test --server <base nuova> --upgrade-from <base vecchia>`, costruisci, distribuisci. Ad ogni patch di sicurezza della base
ricostruisci e distribuisci entro il termine di [Licenza e responsabilità](../product-licensing.md).

## 10. Provare un prodotto

`mosaikit-product test` valida il prodotto, lo avvia sulla base nel profilo sviluppatore e controlla via HTTP: risponde, ha brand e dati About, ogni utente di prova
accede, il Tenant Manager vede ogni plugin proprio. Le pagine dei plugin e l'accessibilità si provano nel browser con `@mosaikit/plugin-testing`.

Con `--browser`, `test` prova anche la shell con il brand del prodotto in un browser: la pagina di accesso mostra il brand e la shell, come Tenant Manager, su desktop
e su telefono, non ha overflow orizzontale (regola R-9 del contratto di layout) e passa il controllo di accessibilità (axe). Serve Playwright nella cartella del prodotto
(`npm install --save-dev @playwright/test @axe-core/playwright @mosaikit/plugin-testing`, poi `npx playwright install chromium`); senza, il comando si ferma e lo dice.
È spento di default perché avvia un browser. Il contratto di layout completo (ogni percorso, ogni regola) resta nella suite end-to-end della base.

## 11. Operatività

Monitoraggio, manutenzione, backup e log sono quelli della piattaforma. Per chiedere supporto raccogli: versione del prodotto e della base (dati About),
il log (`data/logs/mosaikit.log` o `docker compose logs app`) e l'output di `mosaikit-server config`.
