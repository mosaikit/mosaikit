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
| `[[public_commands]]` | chiunque abbia un link pubblico esegue il comando, in sola lettura, sull'elemento condiviso. **Sensibile** (vedi sotto) |
| `run_commands` | un servizio di una distribuzione chiama il comando come la persona che ha avviato un run, in background. **Sensibile** (vedi sotto) |
| `run_targets` | un run avviato da questo plugin può chiamare i comandi per i run di questi altri plugin come la persona. **Sensibile** |
| `directory` | elenca username e nomi di persone e gruppi del tenant a chi può condividere. **Sensibile** (vedi sotto) |
| `[[config]] public = true` | una pagina pubblica può leggere quell'impostazione. Mai un segreto: il manifesto lo rifiuta |
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

## Comandi di esecuzione: lista di controllo

Un comando in `permissions.run_commands` lo chiama un servizio senza sessione, come la persona che ha avviato il run. Il kernel
controlla a ogni chiamata il ticket, il manifest e i permessi della persona, e un ticket con un elenco di risorse è ristretto a
quelle dal database. Non può limitare ciò che la logica **restituisce**: il WASM può restituire dati che ha letto legittimamente.
Questa parte spetta quindi all'autore del plugin, e chi rivede il codice deve controllare ogni comando di esecuzione con questa lista:

1. **Restituisci il minimo che serve al run**, non righe intere, e mai un'impostazione, una chiave o nulla di `ctx.config`.
2. **Controlla su cosa ti chiedono di lavorare.** Gli id arrivano dagli argomenti del servizio; leggili tramite il database (applica
   i permessi della persona e le risorse del ticket) e tratta gli argomenti come scelti da un servizio forse compromesso.
3. **Scrive come la persona.** Tieni le scritture minime e idempotenti: una chiamata ripetuta non deve fare danni.
4. **Usa `ctx.on_behalf()`** per distinguere un run da una chiamata diretta della persona ed essere più severo nel run, mai meno.
5. Dichiara solo i comandi che un run chiama davvero e aspettati che una chiamata fallisca a ticket finito (`run_ticket_invalid`).
6. Un ticket senza elenco di risorse arriva a tutto ciò che la persona può raggiungere per quel comando: chiedi alla distribuzione
   di restringere il ticket quando il comando tocca dati sensibili.

## Directory: la regola per l'autore

`permissions.directory` permette al plugin di cercare tra le persone e i gruppi del tenant (`ctx.directory()`,
`msk.directory.search`). Il kernel ammette solo un Tenant Manager o chi può condividere nel plugin, mostra solo membri attivi del
tenant corrente, dà solo `id`, `username` e `name` (mai un'email), lo rifiuta nei link pubblici e nei run, lo limita e scrive un
evento al minuto senza testo cercato né righe. Non può limitare ciò che il plugin fa della risposta, quindi la regola spetta
all'autore:

1. **Riempi il selettore, nient'altro.** Cerca mentre la persona scrive (con una breve pausa), mostra le righe, dimenticale quando
   l'editor si chiude.
2. **Non salvare né inoltrare mai la directory.** Non copiare nomi o username nelle tue tabelle, impostazioni, log o notifiche oltre
   quanto la persona ha scelto; non restituire l'elenco da un altro comando; non mandarlo a un servizio esterno.
3. **Tieni gli id scelti**, non i nomi (un nome può cambiare; rileggilo per mostrarlo).
4. **Dichiaralo solo se lo usi**, e aspettati `permission_denied` per chi non può condividere: mostra il campo in sola lettura.

## Cosa è firmato

Un `.mskp` è uno zip con `MANIFEST.sha256` (l'hash di ogni file) e `SIGNATURE` (ed25519 su `MANIFEST.sha256`, con la chiave
dell'editore). All'installazione l'host ricalcola ogni hash (nessun file in più o in meno), controlla la firma con le
**chiavi fidate** della configurazione (`trusted_keys`) e la blocklist. `allow_unsigned = true` è solo per lo sviluppo e
segnala il pacchetto. Dettagli: [Pacchetto e firma](packaging.md).

## Comandi dei link pubblici: lista di revisione

Un comando in `[[public_commands]]` lo eseguono degli sconosciuti. Il kernel limita cosa può leggere (l'elemento del link e ciò
che contiene, le chiavi dell'organizzazione o della piattaforma), non cosa **restituisce**: il WASM può restituire dati che ha
letto legittimamente e il kernel non può accorgersene. Questa parte spetta all'autore del plugin, e chi rivede il plugin dovrebbe
controllare ogni comando pubblico con questa lista:

1. **Mai restituire un segreto.** Niente da `ctx.config`, nessuna chiave, nessun URL con un token in una risposta, in un errore
   o in una riga di log. Usa `fetch_with_key`, così la logica non legge mai la chiave.
2. **Mai prendere l'id dell'elemento dagli argomenti.** Usa solo `ctx.link_resource()`. Gli argomenti li sceglie il visitatore.
3. **Considera ostile ogni argomento**: controlla dimensione e forma, usa i parametri nell'SQL, non costruire URL incollandoli.
4. **Bada al costo.** Una richiesta esterna con una chiave spende la chiave a pagamento dell'organizzazione o della piattaforma
   per un visitatore anonimo. Tienila piccola, usa la cache dove puoi e aspettati i limiti (30 al minuto per link, 300 per
   organizzazione).
5. **Restituisci il minimo che serve alla pagina**, non l'intera riga, e dichiara solo i comandi che la pagina pubblica chiama.
6. Ricorda la regola dell'organizzazione: è disattivata di default, quindi la pagina deve funzionare (o dirlo) quando il comando
   viene rifiutato.

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
