# Sicurezza

Cosa protegge la piattaforma da un plugin, e cosa deve fare in cambio chi lo scrive. Architettura §7, §8 e §9.
Versione inglese: [../security.md](../security.md).

## Origini e CSP delle UI dei plugin

La piattaforma ha due origini: l'**app** (la shell e l'API) e quella **non fidata** (`plugin_url`), dove si servono le UI
dei plugin, i contenuti caricati e i link pubblici.

- Una UI di plugin gira in un iframe con `sandbox="allow-scripts allow-same-origin allow-forms allow-popups
  allow-downloads allow-modals"`. Essendo su un'altra origine non può leggere cookie, storage o DOM della shell.
- Parla solo tramite il **bridge postMessage**. L'host controlla che un messaggio venga dall'iframe corrente, lo traduce in
  una chiamata REST **limitata a quel plugin** e la esegue con la sessione della persona. Ogni messaggio che il plugin
  manda va solo all'origine dell'host.
- Con un `plugin_url` con carattere jolly (`https://*.plugins.example.org`) ogni plugin ha un host proprio (il suo id con
  i `.` sostituiti da `-`) e non può incorniciare, eseguire script o leggere lo storage di un altro plugin.
  `mosaikit-plugin dev` usa `http://*.localhost:<porta>`, così si prova con lo stesso isolamento.
- **CSP di una pagina di plugin** (`csp_for`, `crates/server/src/untrusted.rs`): `default-src 'self'`; script solo dalla
  propria cartella sul proprio host (`<script>` inline, gestori `on...=` e indirizzi `javascript:` sono bloccati, e lo è la
  compilazione di codice a runtime: `eval`, `new Function`, salvo `script_eval = true` nel manifesto); gli stili inline sono
  consentiti; le richieste (`connect-src`) solo verso se stessa e le origini di `network`; immagini anche da `network` e
  `frame_src`, `data:` e `blob:`; caratteri e media solo da se stessa e `data:` (e `blob:` per i media); frame solo da se
  stessa, `blob:`, `frame_src` (e qualsiasi indirizzo `http(s)` con `web`); `object-src 'none'`. I file vanno in `ui/dist`;
  `validate --strict` trova ciò che la CSP bloccherebbe.
- Il cookie di sessione è `HttpOnly; SameSite=Strict`; le richieste che modificano dati richiedono il token CSRF, che ha
  solo l'host. Un plugin non vede mai un token.

## Permessi

Un plugin ottiene solo ciò che il suo manifesto chiede, e l'Administrator vede l'elenco quando lo installa. Chiedere il
minimo:

| Permesso | Perché conta |
|---|---|
| `files_read` | legge l'area File **come il chiamante**: mai più di quanto il chiamante vede. **Sensibile** |
| `script_eval` | il plugin può eseguire stringhe come codice. Solo per codice di cui ci si fida. **Sensibile** |
| `network`, `frame_src`, `web` | raggiungono origini esterne; la logica passa dall'host, che rifiuta gli indirizzi privati |
| `calls` | chiamano comandi di plugin indicati; il plugin chiamato applica le proprie regole per lo stesso utente |
| `notify` | inviano notifiche; mai a destinatari scelti da te |
| `files`, `content` | file propri e contenuto di cartelle caricate |

Quando la logica riceve un rifiuto come il testo «the plugin does not declare notify in [permissions]» o
`permission_denied`, nel manifesto manca la chiave; `validate --strict` la trova prima dell'installazione.

I permessi delle **persone** (`use`, `create`, `delete`, `share` e i tuoi `[[user_permissions]]`) sono un'altra cosa: il
kernel applica quelli standard; **la tua logica applica i propri** con `ctx.can`. Nascondere un pulsante con `msk.can` è
solo comodità.

## Cosa è firmato

Un `.mskp` è uno zip con `MANIFEST.sha256` (l'hash di ogni file) e `SIGNATURE` (ed25519 su `MANIFEST.sha256`, con la chiave
dell'editore). All'installazione l'host ricalcola ogni hash (nessun file in più o in meno), controlla la firma con le
**chiavi fidate** della configurazione (`trusted_keys`) e la blocklist. `allow_unsigned = true` è solo per lo sviluppo e
segnala il pacchetto. Dettagli: [Pacchetto e firma](packaging.md).

## Segreti

- I segreti di `[[config]]` e le chiavi di servizi esterni sono cifrati con la chiave segreta dell'installazione e non
  tornano mai al browser. La logica li riceve (`ctx.setting`, `ctx.service_key`): **non metterli mai in un risultato, in una
  riga di log o in un messaggio d'errore**, e non mandarli mai alla UI.
- `fetch_with_key` aggiunge la chiave del servizio lato host, così la logica non la legge mai: preferirla.
- Mai un segreto nel manifesto, nelle migrazioni o nel bundle della UI: li può leggere chiunque installi.
- Tenere la chiave di firma fuori dal repository. La chiave predefinita dello strumento è per utente
  (`%APPDATA%\mosaikit\signing.key`, `~/.config/mosaikit/signing.key`); in CI usare `MOSAIKIT_SIGNING_KEY` o un file chiave.

## Contenuti non fidati

- Trattare come non fidati ogni valore di campo, nome di file e risposta web. Nella UI usare `textContent` e il costruttore
  `el()`, non `innerHTML` con dati.
- La piattaforma serve i contenuti degli utenti con `Content-Security-Policy: sandbox`, `nosniff` e
  `Referrer-Policy: no-referrer`; una pagina che incorpora contenuti degli utenti deve tenerli in un frame in sandbox
  (origine opaca).
- SQL: sempre parametri (`$1`), mai concatenazione di stringhe, anche se ci sono guardia e RLS.
- I percorsi nei pacchetti rifiutano `..`, percorsi assoluti, caratteri di controllo e i nomi che Windows riserva, su ogni
  piattaforma.
- Un layout è CSS dichiarativo controllato all'installazione; una lingua è solo testo. Nessuno dei due esegue codice nella
  shell.

## Il profilo sviluppatore non è un confine di sicurezza

Il profilo (password note, nessun controllo della firma, nessun secondo fattore) è solo per il proprio computer: si rifiuta
di partire su un indirizzo non loopback, con un database su un altro host o dietro un proxy (architettura §8.12). Non
esporlo mai.
