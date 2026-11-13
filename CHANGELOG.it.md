# Novità

Cosa cambia da una versione di Mosaikit alla successiva. La shell mostra la sezione della sua versione in
Aiuto › Novità (un titolo `## <versione>` per versione, voci `- `, gruppi `### `). Questo file è la
versione italiana di [CHANGELOG.md](CHANGELOG.md): tenerli allineati.

## 1.0.15

- Amministratore: la tabella delle persone mostra il nome dell'organizzazione, non lo slug; le schede dei plugin mostrano una pillola «Firmato» al posto della riga della firma (chi ha firmato è nel suggerimento, e nell'elenco e nella pagina del plugin) e sono abbastanza larghe per tutte le loro etichette; i filtri del registro non si sovrappongono più.
- Gestore: la panoramica non si apre più con l'elenco delle app (le ha la barra laterale); le righe di «La mia attività recente» restano dentro la scheda.
- Condivisione: un link pubblico può essere creato senza scadenza quando l'organizzazione non limita la durata, e la finestra dice che il link non scade (o fino a quando funziona) e che funziona a ogni visita; il trasferimento della proprietà non finisce più con un messaggio d'errore quando il vecchio proprietario perde l'accesso: la finestra si chiude.
- La pagina di un plugin mostra una rotella con il suo nome finché non è caricata.
- Plugin: `ctx.directory().users_with(permission, q, limit)` elenca le persone dell'organizzazione che hanno un permesso del plugin (`[[user_permissions]]`) e `msk.share(id, { principals, level })` apre la finestra di condivisione con persone e gruppi già pronti: un flusso di revisione può offrire «condividi con i revisori» e il proprietario conferma in un passo. Stessi diritti della rubrica (`[permissions] directory = true`, Gestore o `share`).
- Profilo sviluppatore: dopo l'accesso il banner a tutta larghezza diventa un pulsante tondo arancione con l'icona dell'insetto («Profilo sviluppatore» come nome e nel suggerimento) nella barra in alto, accanto al selettore dell'organizzazione; è su ogni pagina e non si chiude, il suggerimento e un piccolo pannello portano l'avviso completo e il pulsante degli strumenti per sviluppatori. La pagina di accesso tiene il banner intero. Fuori dal profilo sviluppatore non cambia nulla.
- Sviluppo: `cargo xtask dev` crea l'Amministratore `admin` con la password `mosaikit` (era `admin-sviluppo`); vale per un database nuovo. Il desktop rilasciato parte già con `mosaikit` per `admin` e per l'utente dell'organizzazione di lavoro (`initial_password`).
- La Home di chi non è Gestore si chiama Panoramica, come quella dei Gestori e dell'Amministratore, con la stessa icona.
- Navigazione: l'Amministratore (Sistema › Identità e aspetto › Navigazione) e un Gestore (Impostazioni dell'organizzazione, stesso punto) impostano i gruppi della barra laterale: gruppi e sottogruppi (un livello) con icona e nome in ogni lingua, e l'ordine delle app. Senza un valore l'organizzazione usa i gruppi della piattaforma, e la piattaforma quelli della distribuzione (`[[nav_groups]]`, che ora può avere `[[nav_groups.children]]`). Nella barra aperta un gruppo è un'intestazione con la sua icona e il numero di app, i sottogruppi sono rientrati; in quella chiusa un gruppo è un'icona con un menu di tutte le sue app. Politica del prodotto: `[locked] keys = ["nav.layout"]` la blocca.

## 1.0.14

- Brand di un prodotto: `tagline`, `login_message` e `footer` di `branding/brand.toml` si possono scrivere per lingua, come tabella (`[login_message]` con `en = "..."` e `it = "..."`) al posto di una sola stringa. La pagina di accesso mostra il testo della lingua della pagina, poi il testo semplice, poi `en`; un piè di pagina impostato nelle impostazioni della piattaforma prevale ancora. `validate` accetta entrambe le forme.

## 1.0.13

- Desktop di un prodotto: il file di configurazione prende il nome dell'eseguibile (`geoportal.exe` legge `geoportal.toml`, e la release include `geoportal.example.toml`); `mosaikit.toml` si legge ancora se non c'è il file con il nuovo nome, così un'installazione precedente funziona. `START.txt` e i commenti del file lo nominano. Non rinominati (nomi interni da cui dipendono i dati): `data/logs/mosaikit.log`, `data/database/mosaikit.db`, il database PostgreSQL `mosaikit`, i file delle release Docker e Kubernetes (`mosaikit.toml` dentro l'immagine).

- Desktop (Windows): all'avvio e alla chiusura non lampeggiano più finestre di console: ogni processo di supporto del programma (`initdb`, `pg_ctl`, `pg_dump`, `icacls`) gira nascosto. I sidecar erano già avviati nascosti.
- Desktop: solo «Open» del menu dell'icona (e il clic sull'icona) apre il browser; scegliere un'altra voce (Quit, Data folder...) non apre più una scheda.
- Il file con le credenziali iniziali del primo avvio si chiama `initial-credentials.txt` (era `credenziali-iniziali.txt`); il menu dell'icona apre ancora il vecchio file di un'installazione precedente.
- Un solo meccanismo per i testi dentro le pagine dei plugin: un plugin di lingua porta `lang/ui/<id del plugin>.json` (frase inglese e traduzione), il server lo invia con i testi della lingua (`ui` in `GET /api/languages/{code}`), la shell passa alla pagina del plugin la sua parte nel `context` (`texts`) e il plugin API ha `msk.t(frase, vars?)` e `msk.ownTexts(tabelle)`. Additivo e facoltativo; il plugin API 1 non cambia.
- Comandi pubblici che scrivono: `[[public_commands]]` accetta `write = true` e `[[tables]]` accetta `insert_for = "visitor"`; chi visita un link pubblico può allora aggiungere righe (una risposta a un modulo, un voto) alle tabelle pensate per i visitatori, solo per l’elemento del link e senza mai modificarne o cancellarne una; 10 chiamate al minuto per link, mostrato all’Amministratore come «aggiunge dati».
- Lingue scritte da destra a sinistra: la pagina prende la direzione (`dir`) dalla lingua (arabo, ebraico, persiano, urdu). I plugin di lingua ufficiali ora sono spagnolo, portoghese, francese, olandese, arabo, cinese e russo.
- Canali in tempo reale: un plugin con `permissions.realtime` apre un canale su una risorsa con `msk.realtime.open` (presenza, messaggi a tutti o a una persona, un piccolo stato per persona, su SSE e POST); il kernel si limita a inoltrare, non salva nulla.
- `permissions.media`: il frame del plugin può passare camera, microfono e schermo a un servizio che incorpora (con `frame_src`).
- `mountCrud` ha il tipo di vista `custom`, l'opzione `sort` e un handle con `reload()`; il plugin API ha un kit UI (toast, dialog, menu, popover, tag input, selettore persone, campo data, timeline, kanban, Markdown) e `MockHost::hook_with_previous` per provare gli hook.

## 1.0.12

- Correzione: `mosaikit-product build k8s` senza `--base-k8s` (1.0.11) scriveva i manifest Kubernetes con i segnaposto `{{id}}`, `{{image}}`... non risolti e senza lo script `initdb`, quindi `kubectl kustomize` falliva. Ora i manifest sono compilati con id, nome, versione, immagine e immagine PostgreSQL del prodotto, e il risultato è verificato con `kubectl kustomize` nei test.

## 1.0.11

- `mosaikit-product build k8s` non richiede più `--base-k8s`: i manifest Kubernetes del Base sono dentro il kit, quindi coincidono sempre con la sua versione. `--base-k8s <cartella>` li sostituisce ancora. I `[[sidecars]]` non hanno effetto su Kubernetes (un avviso lo segnala).

## 1.0.10

- I `[[sidecars]]` di `distribution.toml` ora funzionano per i prodotti costruiti con il kit: `mosaikit-product build desktop` copia gli eseguibili in `sidecars/<name>/` e scrive `sidecars.toml`, così l'applicazione desktop avvia un servizio Node, un server di mappe... prima del kernel e lo ferma dopo. Chiavi: `command`, `args`, `env`, `health`, `port`, `depends_on`, `restart`, `kind = "oneshot"`, `files`. `validate` avvisa se manca l'eseguibile; `build docker` e `build k8s` stampano un avviso (usare `[docker] compose_files`).

## 1.0.9

- `mosaikit-plugin dev`, `mosaikit-product dev` e `mosaikit-product test` accettano `--database postgres://…` (o `MOSAIKIT_DEV_DATABASE_URL`): il server di sviluppo gira su un database PostgreSQL di questo computer invece che su SQLite, per i plugin con `[requires] database = "postgres"` (PostGIS). La procedura è in `docs/devkit/data.md`.

## 1.0.8

- `mosaikit-plugin validate --strict` non dice più che `files_read` è inutilizzato quando la pagina del plugin chiama `msk.files.*` (si accetta un plugin la cui sola pagina legge l'area File di un altro plugin).
- `mosaikit-product test --run "<comando>"` esegue un comando del prodotto (i suoi test HTTP o nel browser) contro il prodotto avviato, con `MOSAIKIT_APP` e gli utenti di prova nell'ambiente: per provare un prodotto non serve nessun crate del kernel.
- `[docker] compose_files` e `copy` in `distribution.toml`: la release Docker prende i file compose del prodotto (servizi accanto) e li unisce al `compose.yml` generato tramite `.env`; `validate` controlla i percorsi.

## 1.0.7

- Un plugin con `files_read` può leggere il contenuto di un file dell'area File di un altro plugin: `msk.files.blob(id, source)` (la rotta `GET …/files/{id}/content?source=`), come già poteva elencarla, chiederne la dimensione e ottenere un ticket.

## 1.0.6

- Il log del kit Docker non mostra più un `ERROR` per la cartella vuota dei plugin in sviluppo: dice che non c'è niente da caricare.
- Il plugin creato da `mosaikit-plugin new` ha una pagina a elenco con il modulo dell'elemento in una finestra (si apre con «Nuovo» e quando selezioni una riga), lo stato come etichetta colorata e lo stato vuoto illustrato. `mountCrud` ha le opzioni `form: 'modal'` e `cell` per i plugin che vogliono lo stesso.
- La release Docker di un prodotto ha un `README.md` con cos'è la cartella, le credenziali predefinite di una nuova installazione, come recuperare il secondo fattore e la password, e dove leggere altro.
- La pagina di accesso di Keycloak in quella release ha l'aspetto della pagina di accesso del prodotto: una fascia con il nome, la frase e il logo del brand, il modulo a destra, i colori del brand.
- Il pulsante del tenant di esempio dice «Accedi con SSO» (diceva «Accedi con Sign in with Keycloak»).
- Un accesso tramite identity provider avviato a un indirizzo dell'app diverso da quello di `MOSAIKIT_URL` (per esempio `127.0.0.1` invece di `localhost`) ora lo dice, invece di «avviato in un altro browser».
- `mosaikit-product validate`, `dev` e `test` prendono da soli la Base del Dev Kit quando il prodotto tiene plugin ufficiali.

## 1.0.5

- `mosaikit-product build desktop` e `build docker` non richiedono più `--base`: senza, la Base è la versione del Dev Kit che usi, che esce insieme. `--base` resta per un'altra versione, una cartella o uno `.zip`.
- `cargo xtask docs` produce i manuali PDF (utente, installazione, sviluppatore, architettura), in inglese, e una presentazione PowerPoint di Mosaikit, con i vantaggi, l'ingombro misurato e una stima di tempi e costi risparmiati rispetto a partire da zero. Ogni release li allega.

## 1.0.4

- La pagina di accesso di Keycloak nella release Docker di un prodotto mostra il logo una volta sola, un titolo leggibile e la scheda a tutta larghezza.

## 1.0.3

### La piattaforma

- Un prodotto può creare al primo avvio un tenant d'esempio che accede tramite un identity provider: `[bootstrap.idp_demo]` in `distribution.toml` (tenant, issuer, client id, gruppi dei Tenant Manager e degli Utenti; il segreto del client è letto da una variabile d'ambiente, mai dal file). Non succede nulla nel profilo sviluppatore o se il tenant esiste.

### Il kit di sviluppo

- La release Docker di un prodotto può avviare anche Keycloak (`[docker] keycloak = true`, il valore predefinito di `mosaikit-product new`): un realm col nome del prodotto, una pagina di accesso con logo e colori del brand, tre persone di prova e il tenant d'esempio `idp-demo`, per provare subito l'integrazione con un identity provider tramite OpenID Connect. È una dimostrazione e richiede una base dalla 1.0.3: `validate` lo dice.

## 1.0.2

### Il kit di sviluppo

- `mosaikit-product` prende da solo la Base: `--base 1.0.2` (o `MOSAIKIT_BASE=1.0.2`) scarica una volta il kit desktop di quella release, lo verifica con il `SHA256SUMS` firmato e lo tiene in una cache (`MOSAIKIT_CACHE` la sposta). Per un prodotto basta il Dev Kit, come per un plugin. Con `--base <versione>` l'immagine Docker della base è `ghcr.io/mosaikit/mosaikit:v<versione>` da sola.
- La release firma insieme al Dev Kit anche il kit desktop della Base, ed è ciò che rende possibile quella verifica (le release precedenti non lo elencano: si usa il loro zip a mano).
- `mosaikit-plugin new` prende l'SDK e il pacchetto della UI dal kit in cui si trova lo strumento: niente `--kit`. Una build fallita di un plugin che chiede l'SDK al registro dice cosa cambiare.
- `mosaikit-product build` dice chiaramente quando un plugin di `include` non è né nei roots né nella base.
- I documenti sono rivisti per la via più breve a un plugin e a un prodotto: cosa scaricare (solo il Dev Kit), il brand di un prodotto (logo, favicon, icona, colori, testi) e l'immagine base pubblica.

## 1.0.1

### La piattaforma

- Il primo aggiornamento della piattaforma dopo la 1.0.0, fatto perché un prodotto possa essere provato su una base e poi spostato sulla successiva con i suoi dati. Non cambia nessun comportamento del kernel, della plugin API o della shell: un prodotto costruito per `>=1.0, <2` gira così com'è.

## 1.0.0

### Le distribuzioni

- Una distribuzione può raggruppare le app della barra laterale (`[[nav_groups]]` in `distribution.toml`: id, etichetta, icona, i plugin in ordine, etichette in altre lingue). La barra aperta mostra un'intestazione comprimibile per gruppo; quella chiusa mostra l'icona del gruppo e un menu con le sue app e le loro pagine. Le app che nessun gruppo elenca restano in fondo. Gli altri layout mantengono l'elenco piatto.
- Una distribuzione può includere dei sidecar (`[[sidecars]]` in `distribution.toml`): processi aggiuntivi accanto all'app. L'app desktop li avvia prima del kernel (con un messaggio di avanzamento, un tempo massimo e un errore chiaro se uno non parte), li riavvia secondo la loro politica, ne registra l'output e li ferma dopo il kernel; le release Docker e Kubernetes aggiungono un servizio per ciascuno. I loro indirizzi sono consentiti automaticamente per le richieste dei plugin.
- Un sidecar può essere un'attività una tantum (`kind = "oneshot"`, per esempio l'inizializzazione di un database): viene eseguita fino al termine prima che partano i sidecar che ne dipendono, e un errore o un tempo scaduto interrompono l'avvio mostrando la fine del suo log. Un sidecar può anche ricevere file della distribuzione (`files`, per esempio una configurazione) dove li aspetta, su desktop, in Docker e in Kubernetes.

### La shell

- La barra laterale ha uno stile più sobrio: niente linee di separazione né linee attorno alla voce selezionata (ha uno sfondo morbido e il colore di accento); in un gruppo le app sono rientrate sotto il titolo e le loro pagine un livello più in basso; le icone della barra chiusa sono equidistanti; i menu della barra chiusa mostrano l'icona di ogni voce; Panoramica e Impostazioni mantengono il nome breve anche con la barra aperta; nella barra chiusa i menu si aprono anche fermando il mouse su un'icona (quelle icone non mostrano il suggerimento sopra il menu; un menu aperto così non prende mai il focus della tastiera, e cliccando una voce il suo menu non si apre sopra la pagina).
- Le pagine pubbliche (link pubblici) possono ora essere incorporate per impostazione predefinita dai siti statici della stessa installazione, senza alcuna impostazione; i siti elencati in Impostazioni › Incorporamento si aggiungono, e nessun altro può incorporarle.

- Le liste e le schede rimaste con una riga spoglia quando sono vuote (le due liste di Gestione › In attesa, Home senza app, consumi, backup, log e widget della panoramica, membri di un gruppo) ora mostrano un'illustrazione con titolo e azione, in versione piccola dentro un widget o una sezione.
- La scheda Panoramica di un plugin sta nello schermo: le immagini a sinistra, le informazioni a destra (scorrono da sole solo se sono più lunghe dello schermo). Ogni plugin ufficiale ha ora due immagini realistiche.
- Una nuova interfaccia per ogni ruolo, in italiano e in inglese, con modo chiaro, scuro e automatico.
- La barra in alto la decide l'Administrator: logo e nome, ricerca, lingua, aiuto e modo.
- Temi: Mosaikit, Italia e Tessera, più i temi creati con l'editor dei temi, verificati per il contrasto
  (WCAG 2.1 AA). Alto contrasto per chi legge con fatica.
- Ricerca ovunque: pagine, app e gli elementi delle app che puoi vedere (Ctrl K).
- Aiuto: un tour guidato delle pagine principali, la guida, le novità e le scorciatoie da tastiera.
- Panoramiche a widget per ogni ruolo: le app in una striscia compatta, numeri rapidi, notifiche, attività recente, scadenze e, per l’Amministratore, le organizzazioni per spazio, le richieste e gli errori recenti.
- Le panoramiche riempiono la pagina senza buchi (una griglia fitta a quattro, due o una colonna). L’Amministratore vede una scheda per ogni app, con piccoli grafici di elementi e spazio, e un grafico dello spazio per app.
- Intestazioni, filtri e schede restano ferme. Le pagine che sono una lista o una tabella non scorrono per intero: la lista riempie la pagina e scorre al suo interno, con la riga di intestazione sempre visibile, e carica altri elementi scorrendo. Le pagine delle app hanno la stessa intestazione delle pagine di Mosaikit, e una pagina con sottosezioni (Sistema, Monitoraggio, Impostazioni, Utilizzo, Account, Gestione) mostra nell’intestazione sia la pagina sia la sottosezione scelta. L’elenco delle sezioni di una pagina resta fermo e scorre da solo. Un layout salvato è usato subito, senza ricaricare la pagina. La barra laterale scorre, chiusa o aperta, e mostra la barra di scorrimento solo sotto il mouse.
- Le liste e le tabelle lunghe si caricano una pagina alla volta, con il conteggio e «Carica altri» (o scorrendo), anche il Registro.
- Nelle liste lunghe che si caricano una pagina alla volta (Tenant, Persone, Elementi, Inviti, Cestino, il Registro e le liste delle app) i titoli delle colonne ordinano tutta la lista, non solo le righe già caricate: la prima riga è la prima o l'ultima di tutto. Una colonna che il server non può ordinare (un conteggio, un valore calcolato) è solo testo.
- Ogni tabella funziona allo stesso modo, nella shell e nelle app: la riga delle intestazioni resta ferma e scorrono solo le righe, i titoli delle colonne ordinano, un campo di filtro nell'intestazione cerca in ogni campo e altre righe si caricano quando si arriva in fondo. I plugin installati si vedono anche come schede (predefinito) o come tabella. La stessa tabella è usata dentro schede e finestre (i dati sotto i grafici, l'importazione da CSV e i suoi esiti, gli elementi di un backup, le estensioni di un plugin); le matrici dei permessi, i tipi di notifica e la capacità delle quote restano griglie ma con lo stesso aspetto, con riga delle intestazioni e prima colonna sempre in vista.
- In Contatti, Attività e Note il pannello con i dettagli compare solo quando apri un elemento o ne crei uno nuovo; altrimenti l’elenco usa tutta la larghezza.
- Le note sono post-it colorati: otto colori (leggibili in modo chiaro e scuro), scelti nell’editor o da un piccolo menu sulla nota, leggermente inclinati e dritti sotto il puntatore. Trascina l’angolo piegato, oppure premi Alt e i tasti freccia, per ridimensionare un post-it; la dimensione viene ricordata. La vista Elenco resta disponibile.
- Le note hanno tag tuoi, ciascuno con il proprio colore: creali, rinominali, cambia il colore ed eliminali dal pulsante Tag (eliminare un tag lo toglie dalle tue note), e filtra le note per tag.
- Le pagine e gli elenchi vuoti mostrano un’illustrazione con un titolo, una riga di spiegazione e i pulsanti di cosa fare, uguali nella shell (Tenant, Plugin, Gruppi, Richieste di accesso, Condivisioni, Cestino, Notifiche) e nelle app; un filtro senza risultati mostra un piccolo messaggio con il link per azzerarlo.
- Documenti: l'elenco e il pannello dei dettagli sono un unico blocco piatto; la barra dei file selezionati mostra solo le icone (il nome compare come tooltip); il pannello non scorre più in orizzontale; i PDF si vedono nel pannello e nel visualizzatore grazie all'app stessa, quindi funzionano in ogni browser. Le barre di scorrimento sono sottili come quelle di Mosaikit in tutte le app.
- Documenti: una cartella con molti file si apre subito: l'elenco e la griglia mostrano 100 elementi alla volta e gli altri arrivano scorrendo (in fondo il piè di lista dice «N di N elementi»). Ctrl+A, la selezione con Maiusc e i tasti freccia valgono per tutta la cartella.

### Persone e tenant

- Impostazioni su tre livelli: la piattaforma, il tenant e ogni persona. Ogni impostazione dice se è
  ereditata, personalizzata o gestita dalla piattaforma.
- Persone e permessi: profili di permesso, gruppi, inviti di persone di altri tenant e richieste di
  vedere o modificare un elemento, decise dal proprietario o da un Tenant Manager.
- Una password dimenticata si sostituisce con un link che vale una volta sola. Nella pagina di accesso, **Password dimenticata?** manda quel link all'indirizzo email dell'account.
- Ogni account locale ha un indirizzo email (obbligatorio quando lo si crea o lo si importa).
- Il tuo nome e la tua immagine: li cambi in Account › Profilo (il nome arriva dal provider di identità
  nei tenant che ne usano uno).
- Accesso tramite il provider di identità di un tenant (OIDC), accanto agli account locali; i gruppi del
  provider possono diventare gruppi del tenant.
- Quote dei tenant con i consumi, l'andamento e gli avvisi.

### Il tuo lavoro

- Notifiche nella campanella, per email e in un riepilogo giornaliero.
- Condivisioni e link pubblici di ogni elemento, il cestino per 30 giorni e il registro di quello che è
  successo.
- Plugin attivi o spenti per tenant, con estensioni che aggiungono campi, azioni e schede alle app.
- Chiavi dei servizi esterni: i plugin dicono quali servizi usano, e solo quelli compaiono.
- I siti statici possono mostrare un indirizzo web dentro Mosaikit (un sito che vieta l'incorporamento si apre in una nuova scheda), come schede o come elenco con miniature.
- I contatti sono schede con le iniziali di ogni persona e un pannello di lettura, le attività un elenco o una bacheca (in ritardo, aperte, fatte) con etichette di stato e una casella, le note schede che si aprono in un pannello di lettura prima di modificarle; su telefono il pannello copre l'elenco.

### Per chi scrive plugin

- Le pagine dei link pubblici possono fare di più. Un plugin può marcare un'impostazione `public = true` in `[[config]]` e la pagina la legge con `msk.publicConfig()` (mai un segreto: il manifest viene rifiutato), e può dichiarare `[[public_commands]]`, comandi che chiunque abbia un link pubblico può eseguire con `msk.publicCall(name, args)`. Girano in sola lettura, senza utente, sul solo elemento condiviso, senza segreti nelle impostazioni, con la chiave dell'organizzazione o della piattaforma e mai una personale, entro un limite di chiamate (30 al minuto per link, 300 per organizzazione) e un budget di calcolo più piccolo. L'Administrator li vede quando il plugin viene installato, e un Gestore deve attivare la nuova regola «Comandi pubblici» (disattivata di default) in Gestione › Impostazioni. L'autore del plugin non deve comunque restituire un segreto né prendere l'elemento dagli argomenti: vedi la pagina Sicurezza del kit di sviluppo. Sono aggiunte all'API 1 (nessuna nuova versione); un plugin che le usa richiede `[requires] mosaikit = ">=1.0"`.
- Un run può raggiungere altri plugin. Un plugin li elenca in `[permissions] run_targets` (lo vede l’Amministratore); lo stesso ticket nomina quei plugin con i loro comandi (solo quelli che ciascuno dichiara in `run_commands`), una pianificazione li nomina in `[[schedules]] targets` e il comando che avvia un run può chiedere il ticket con `runs.mint`. Ogni controllo è rifatto a ogni chiamata: il bersaglio deve essere ancora dichiarato, attivo nel tenant e usato dalla persona, i cui diritti sono gli unici in gioco. Usi, frequenza e durata sono condivisi da tutto il ticket e un ticket non ne emette altri.
- Una distribuzione può chiamare un plugin per conto di un run in background. La persona che avvia il run emette un **ticket di esecuzione** (`POST /api/t/{t}/run-tickets`) per un plugin, un elenco dei suoi comandi, un tempo breve (15 minuti di default, 60 al massimo), un numero di chiamate e, se serve, un elenco di risorse; il servizio lo riscatta a ogni chiamata (`POST /api/run/{ticket}/call/{plugin}/{command}`) senza sessione. Un plugin elenca i comandi che un run può chiamare in `[permissions] run_commands` (mostrati all'Amministratore quando il plugin viene installato); il comando gira come la persona con i suoi permessi al momento della chiamata, vede `ctx.on_behalf()`, e con un elenco di risorse è il database stesso a non mostrargli altro. Il token non viene mai salvato, un ticket può essere revocato dalla persona, da un Tenant Manager o dal servizio, e ogni emissione e chiamata è nel Registro. L'autore del plugin non deve comunque restituire più di quanto serve al run: vedi la pagina Sicurezza del kit di sviluppo. È un'aggiunta all'API 1 (nessuna nuova versione); un plugin che la usa richiede `[requires] mosaikit = ">=1.0"`.
- Un plugin può cercare tra le persone e i gruppi del tenant. `[permissions] directory = true` gli dà `ctx.directory().users(q, limit)` e `.groups(q, limit)` nella logica e `msk.directory.search({ kind, q, limit })` nella pagina, per un selettore suo (un assegnatario, un revisore). Può usarlo solo un Tenant Manager o chi può condividere nel plugin; la risposta è `{ id, username, name }` dei membri attivi del tenant corrente (mai un'email) o `{ id, name }` dei suoi gruppi, al massimo 50 righe; è rifiutato nei link pubblici e nei run, limitato, e il Registro riceve un evento al minuto senza testo cercato né righe. L'Amministratore lo vede quando il plugin viene installato. Il plugin non deve salvare né inoltrare l'elenco oltre quanto serve all'editor a schermo: vedi la pagina Sicurezza del kit di sviluppo. È un'aggiunta all'API 1 (nessuna nuova versione); un plugin che la usa richiede `[requires] mosaikit = ">=1.0"`.
- Un plugin può cambiare la barra superiore per una risorsa a pagina intera. `msk.band.set({ search, mode, presence, comments })` chiede alla shell di togliere la ricerca, mostrare un interruttore Vista | Modifica (o «Sola lettura» se la persona non può modificare), le persone connesse (tre avatar e «+N») e un pulsante dei commenti; la shell controlla tutto ciò che la pagina invia, non lascia mai a un plugin nascondere tenant, campanella, aiuto o menu della persona, e restituisce la barra alla chiusura della pagina. Non serve alcun permesso. Un'aggiunta all'API 1 (nessuna nuova versione); un plugin che la usa richiede `[requires] mosaikit = ">=1.0"`.
- L'API dei plugin ha una versione: **API 1**. Il manifest dichiara per cosa è stato creato un plugin: `[requires] mosaikit = ">=1.2, <2"` (le versioni di Mosaikit con cui funziona) e `[requires] api = 1`. Un plugin fuori dall'intervallo, o creato per un'altra API, non si installa: un solo messaggio chiaro indica l'intervallo e la versione di Mosaikit, e Plugin › Aggiornamenti mostra lo stesso motivo accanto alla versione che non si può installare. Le vecchie chiavi `abi` e `min_kernel` funzionano ancora per una versione maggiore (un plugin caricato dalla sua cartella in sviluppo registra un avviso); `[contribution]` è facoltativo. Rilascia questo Mosaikit prima del primo plugin che usa `[requires]`: quelli più vecchi rifiutano la tabella.
- La UI di un plugin e la shell concordano la versione dell'API all'apertura della pagina (`msk.api`, `API_VERSION`): un plugin creato per un'API più recente di quella della shell viene rifiutato con il codice `incompatible_api` e la persona è invitata ad aggiornare Mosaikit.
- Un errore della logica può portare un codice suo (`Error::coded("invoice_locked", "...")` nell'SDK); arriva alla UI del plugin come `BridgeError.code`, e i codici sono tipizzati (`ErrorCode`).
- `mosaikit-plugin-sdk` e `@mosaikit/plugin-api` hanno una versione propria (1.0.0), un registro delle modifiche e un README. Il pacchetto UI elenca le esportazioni una per una e tiene private le parti interne; l'SDK nasconde la sua infrastruttura (`Ctx` è `#[non_exhaustive]`). L'evento `theme` è deprecato a favore di `context`. Regola di deprecazione: un elemento deprecato resta per una versione maggiore, è segnato e registrato in sviluppo, e viene tolto nella successiva. Le funzioni che nessun plugin ufficiale usa ancora sono segnate come sperimentali nel documento di architettura.
- Nuovo permesso del manifest `[permissions] script_eval = true` (predefinito false): solo la UI di quel plugin riceve `'unsafe-eval'` e `'wasm-unsafe-eval'` in `script-src` e `worker-src`, per i motori che compilano codice a runtime. La shell, i contenuti, i link pubblici e ogni plugin che non lo dichiara mantengono la policy rigida; l'Administrator lo vede in «Cosa richiede» del plugin come permesso sensibile.
- Un plugin può chiamare un servizio esterno con la chiave impostata da un Administrator: `http.fetch` accetta una `key` (un servizio di `[[service_keys]]`) e l'host la aggiunge come bearer token; l'indirizzo può essere quello impostato in Chiavi dei servizi esterni (`address = true`). Le richieste dei plugin passano dalla stessa protezione dell'anteprima delle pagine (solo indirizzi pubblici). L'SDK ha `ctx.http().fetch_with_key(...)`.
- Note traduce una nota con un servizio di traduzione (Traduci la nota, sotto la nota), come esempio.
- I pulsanti distruttivi dei plugin (Elimina) restano ben leggibili in modalità scura, come nella shell. Note 0.5.0 mostra nell'intestazione la pagina aperta (Note › Le mie note).
- La brochure del manifest (descrizione, immagini, autore, licenza, link) appare come pagina completa nel dettaglio del plugin; i plugin ufficiali ora hanno immagini e testi.

- `mountCrud` può disegnare da sé gli elementi (`views`: elenco, schede o bacheca, con un selettore) accanto a un pannello di dettaglio e a un pannello di lettura (`reader`); `avatar`, `chip` ed `el` sono funzioni condivise.
- La logica di un plugin conosce i gruppi della persona che la chiama (`ctx.groups`).
- La logica può notificare la persona che la chiama, o le persone che vedono uno dei suoi elementi,
  con la nuova operazione `notify` dell'host (`[permissions] notify = true`, `ctx.notify` nell'SDK).

### La piattaforma

- Chi installa può aprire ai plugin che lo dichiarano un servizio della rete privata: `allow_private_fetch_hosts = ["host:porta"]` in `mosaikit.toml` (solo voci esatte). Tutto il resto resta protetto.
- Una distribuzione può precompilare le impostazioni dei plugin (segreti compresi) e le chiavi di piattaforma dei servizi esterni con `[[plugin_settings]]` e `[[service_key_values]]`, da `env:NOME` o `file:PERCORSO`. Si applicano una sola volta, solo se non ancora impostate, e non sovrascrivono mai la scelta di un Amministratore.

- Gli Administrator hanno un'email obbligatoria e unica. La cambiano da Account (password attuale e secondo fattore); nome ed email di un altro Administrator si cambiano da Sistema › Administrator.
- Sistema › Email dice che cosa manca e come configurarla, con un'impostazione pronta per un server di prova locale (Mailpit nell'ambiente di sviluppo).

- Tenant con un periodo di prova, archiviati o eliminati, esportati e importati di nuovo.
- Backup ogni giorno, con il ripristino di un tenant intero o di un singolo elemento.
- Modalità manutenzione, anche programmata, con un avviso per tutti.
- Monitoraggio di servizi, prestazioni, errori e capacità, con avvisi.
- Una nuova lingua è un plugin: una volta installato compare nei menu delle lingue. Il plugin dello spagnolo ora traduce tutta l'interfaccia e i testi di ogni plugin ufficiale.
