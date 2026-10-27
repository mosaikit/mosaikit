# Mosaikit — Guida per l'Administrator

L'Administrator gestisce la piattaforma: i tenant, le persone dell'installazione, i plugin, le impostazioni
di sistema, i backup, la manutenzione e il monitoraggio. Gli Administrator sono account della piattaforma,
separati dalle persone dei tenant: non lavorano dentro un tenant e non vedono mai il contenuto degli
elementi. Quello che fa il Tenant Manager è in [tenant-manager.md](tenant-manager.md); il lavoro di tutti in
[user.md](user.md).

## Primo avvio e accesso

Al primo avvio Mosaikit crea l'Administrator `admin`. La sua password è quella data al server
(`MOSAIKIT_ADMIN_PASSWORD`) oppure, se non è stata data, una password generata scritta nel file
`credenziali-iniziali.txt` della cartella dei dati (la versione desktop può creare anche un primo tenant di
lavoro e il suo Tenant Manager, elencati nello stesso file). Cambia la password al primo accesso ed elimina
il file.

Per accedere: nella pagina di accesso **Accesso amministratori** (oppure l'indirizzo di Mosaikit seguito da
`#/admin`).

1. **Utente** e **Password**.
2. **Secondo passaggio**: il codice della tua app di autenticazione. La prima volta, **Registra l'app**:
   inquadra il QR code con Google o Microsoft Authenticator, FreeOTP o simili (oppure scrivi la chiave a
   mano), inserisci il **Codice mostrato dall'app** → **Attiva e accedi**.
3. **Codici di recupero**: dieci codici, ognuno vale una volta se perdi il telefono. **Copia i codici**,
   conservali al sicuro → **Ho salvato i codici: continua**. Non verranno più mostrati.

Gli Administrator accedono sempre con la loro password locale e il secondo fattore, qualunque cosa usino i
tenant.

Gli **Administrator** si gestiscono in **Sistema › Administrator**: **Nuovo Administrator** (registra il
secondo fattore al primo accesso), **Reimposta la password**, **Reimposta il secondo fattore** (registra di
nuovo l'app), **Disabilita** / **Riattiva**. Almeno un Administrator resta sempre attivo.

Mentre lavori la barra mostra **Piattaforma**: sei sulla piattaforma, non dentro un tenant.

## La tua sidebar

**Panoramica della piattaforma**, **Tenant**, **Persone**, **Plugin**, **Monitoraggio**, **Registro** e
**Sistema** in fondo. La panoramica ha i numeri della piattaforma, **Servizi** (il loro stato) e **Da fare**
(avvisi, un backup non riuscito, prove che scadono entro una settimana, aggiornamenti dei plugin), con i
link.

La ricerca (`Ctrl K`) trova, oltre alle pagine, i tenant e le persone.

## Tenant

### Creare un tenant

**Tenant › Nuovo tenant** apre una finestra in quattro passi:

1. **Tenant**: **Nome** e **Identificativo** (lettere minuscole, cifre e trattini: va nell'indirizzo e non
   cambia); facoltativo un **Periodo di prova** con la sua **Fine della prova**.
2. **Accesso**: **Account locali** oppure **Provider di identità (OIDC)** (issuer, client id, client secret;
   ruoli, gruppi e la verifica sono poi nella scheda **Accesso** del tenant).
3. **Tenant Manager**: il primo Tenant Manager, un account locale con una **Password iniziale**; invita gli
   altri e sceglie le impostazioni del tenant.
4. **Riepilogo**: cosa prepara da sola la piattaforma (il profilo di permesso *Standard*, i plugin
   disponibili per default, le impostazioni della piattaforma, il suo posto nei backup e nel Monitoraggio) →
   **Crea il tenant**.

### La pagina di un tenant

Schede **Dati**, **Persone**, **Accesso**, **Plugin**; il badge dello stato (attivo, in prova, sospeso,
archiviato) accanto al nome; **⋯** con **Sospendi il tenant** / **Riattiva il tenant**.

- **Dati**: nome e identificativo, le **Quote** del tenant, il **Periodo di prova** (**Aggiorna la prova**,
  **Togli la prova**), il **Logo del tenant** (sola lettura: lo sceglie il suo Tenant Manager),
  **Esportazione** e l'area **Archivia o elimina**.
- **Persone**: utenti e ruoli, mai i contenuti — per nominare o sostituire un Tenant Manager (**Nuovo Tenant
  Manager**, cambia un **Ruolo**) e per sbloccare un accesso (**Reimposta la password**).
- **Accesso**: vedi *Accesso di un tenant* più sotto.
- **Plugin**: quali plugin sono disponibili e attivi nel tenant (sola lettura; la disponibilità si decide
  nella pagina di ogni plugin).

### Prova, sospensione, archiviazione, eliminazione

| Azione | Cosa succede |
|---|---|
| **Periodo di prova** | Una settimana e un giorno prima della fine vengono avvisati i Tenant Manager e gli Administrator; alla fine il tenant viene sospeso; i dati restano. |
| **Sospendi il tenant** | Le sue persone non possono più accedere; non si cancella niente. **Riattiva il tenant** lo riporta indietro. |
| **Archivia il tenant** | Nessuno accede, non si cancella niente; **Riattiva** lo riporta indietro. La conferma elenca cosa contiene. |
| **Elimina il tenant** | Sparisce tutto, definitivamente: le persone che vi appartengono, gli ospiti perdono l'accesso, elementi e contenuti, gruppi, impostazioni e registro. Gli elementi che le sue persone possiedono in altri tenant passano ai Tenant Manager di quei tenant. Scrivi l'identificativo per confermare. Esportalo prima se potrebbe servirti. Il tenant *Sistema* non si può eliminare. |

### Esportazione e importazione

- **Esporta il tenant** (Dati): uno zip con i dati del tenant, le righe dei suoi plugin e i suoi contenuti.
- **Tenant › ⋯ › Importa un tenant** con quello zip: il tenant torna con le sue persone, gli elementi e i
  contenuti. Se il tenant esiste, Mosaikit chiede prima di sostituirlo (tutto quello che contiene adesso
  viene eliminato). Le persone di altri tenant che non esistono più restano fuori.
- Un'esportazione torna solo sullo stesso tipo di database (PostgreSQL o SQLite), e i suoi segreti cifrati
  solo con la stessa chiave segreta del server.

## Accesso di un tenant

Pagina del tenant › **Accesso**. Un metodo per tenant, mai entrambi:

- **Account locali**: utente e password gestiti da Mosaikit; le persone le crea il Tenant Manager.
- **Provider di identità (OIDC)**: la password la chiede il provider del tenant; le persone vengono create
  al loro primo accesso.

Per il provider di identità:

1. Registra Mosaikit nel provider come client confidenziale con gli indirizzi mostrati: **Indirizzo di
   ritorno (redirect URI)**, **Indirizzo del logout back-channel**, **Indirizzo del logout front-channel**,
   **Indirizzo dopo l'uscita** (ognuno con un pulsante per copiarlo).
2. Compila **Indirizzo del provider (issuer)**, **Client id**, **Client secret** (conservato cifrato, poi se
   ne vedono solo gli ultimi caratteri), **Scope**, **Testo del pulsante** (la pagina di accesso mostra
   «Accedi con …»).
3. **Verifica la configurazione**: una riga per ogni verifica (documento di discovery, PKCE, chiavi di firma,
   uscita, logout back-channel e front-channel), verde, avviso o rossa con il motivo.
4. **Da dove arrivano i ruoli**:
   - **Gestiti in Mosaikit**: il provider dice solo chi è la persona; i ruoli li dà il Tenant Manager.
   - **Gruppi del provider di identità**: il ruolo si legge dai gruppi del token a ogni accesso (**Gruppi dei
     Tenant Manager**, **Gruppi degli User**; vuoti: chiunque il provider lasci entrare è User). Una persona
     che non è in nessun gruppo ammesso viene rifiutata.
5. **Gruppi del provider in Mosaikit** (facoltativo, con **Solo i gruppi che iniziano con**): i gruppi del
   token diventano gruppi del tenant in sola lettura, con cui condividere elementi. Un gruppo che il provider
   non invia più si svuota, non viene mai eliminato.
6. **Claim del token**: quali claim danno utente, nome completo, email e gruppi. Una persona è riconosciuta
   dall'issuer e dal subject del token, mai dall'email.
7. **Salva**. Con il provider di identità gli account locali del tenant non possono più accedere (Mosaikit
   chiede conferma); gli ospiti di altri tenant continuano ad accedere dal loro tenant.

Quando il provider fa uscire una persona (logout back-channel o front-channel), le sue sessioni di Mosaikit
si chiudono.

Consiglio: con **Gestiti in Mosaikit**, dopo il primo accesso del futuro Tenant Manager tramite il provider,
dagli il ruolo in **Persone**: il primo Tenant Manager locale non potrà più accedere.

## Persone dell'installazione

**Persone** elenca tutte le persone (anche gli Administrator), con le pillole **Tutte**, **In più tenant**,
**Administrator**, filtri per tenant, ruolo e stato, ricerca.

- **Nuova persona**: un account locale con il suo tenant di **Appartenenza**, ruolo e profilo; **Password
  iniziale (facoltativa)** — vuota: ricevi un link che la persona usa per sceglierla.
- Seleziona persone per **Disabilita**, **Riattiva**, **Aggiungi a un tenant**, **Invia il link per la
  password** (un link per persona, **Copia tutti**).
- La pagina di una persona: **Profilo**, **Tenant** (ruolo e profilo in ogni tenant, sospendi o togli — non
  quello di appartenenza —, **Aggiungi a un tenant**, **Sposta il tenant di appartenenza**), **Accesso** (link
  per la password, sessioni), **Attività** (i suoi eventi in ogni tenant).
- **Disattiva l'account** / **Riattiva l'account**: un account disattivato non accede da nessuna parte.
- Le persone cambiano da sé nome e immagine in Account › Profilo; la loro email si cambia qui.

Nei tenant con un provider di identità le azioni sulla password non ci sono: le password le gestisce il
provider.

## Plugin

**Plugin** ha **Installati**, **Aggiornamenti** e **Catalogo**, un filtro per tipo (**App**, **Servizi**,
**Estensioni**) e **Installa da file** (un pacchetto firmato `.mskp`).

- Seleziona plugin per **Aggiorna**, **Disattiva** (in tutti i tenant) o **Disinstalla** (i loro elementi
  spariscono da tutti i tenant; la conferma dice quanti elementi, tenant ed estensioni sono coinvolti).
- **Aggiornamenti** elenca le versioni più recenti con le note di rilascio; **Catalogo** quello che offrono i
  registri fidati.
- La pagina di un plugin, schede:
  - **Panoramica**: versione, firma, stato, cosa porta l'aggiornamento.
  - **Cosa chiede**: logica sul server, hook, file, rete, altri plugin, database, e i **Permessi che porta**
    (oltre a usare, creare, eliminare e condividere).
  - **Tenant**: **Disponibile a tutti i tenant** (il valore per i nuovi tenant e per quelli senza una scelta
    propria) e una riga per tenant con **Disponibile** e se il tenant lo ha attivato; **Ripristina** torna al
    valore predefinito.
  - **Configurazione**: le impostazioni che il plugin dichiara, per tutta la piattaforma; i segreti sono
    cifrati e non si vedono più.
  - **Estensioni**: le estensioni che gli aggiungono campi, azioni o schede.
- **Disponibile** è una tua decisione; **Acceso** è del Tenant Manager. I Tenant Manager vengono avvisati
  quando cambia la disponibilità. Un'estensione funziona in un tenant solo dove il suo plugin è acceso.

## Sistema

**Sistema** raccoglie le impostazioni della piattaforma, per tutti i tenant. Le impostazioni che i tenant
possono personalizzare hanno un interruttore **I tenant possono personalizzarla**: spento, i tenant vedono il
valore con un lucchetto. Le regole con un limite (password, sessioni) sono minimi: i tenant possono solo
renderle più severe. **Salva** compare solo dopo una modifica.

| Sezione | Cosa contiene |
|---|---|
| **Administrator** | Gli account della piattaforma (vedi *Primo avvio*). |
| **Email** | **Server di posta** (**Server SMTP**, **Porta**, **Sicurezza**, **Utente**, **Password** conservata cifrata), **Mittente** e **Piè di pagina** con un'anteprima, **Invia una prova**. Senza un server non parte nessuna email. |
| **Notifiche** | Le impostazioni predefinite delle email (**Mai**, **Subito**, **Un riepilogo al giorno**) e l'ora del riepilogo giornaliero. |
| **Conservazione** | Per quanto tempo cestino (predefinito 30 giorni), registro (predefinito 365 giorni) e notifiche (predefinito 90 giorni) conservano il loro contenuto. |
| **Password e sessioni** | Lunghezza minima della password (mai sotto 10), tentativi prima del blocco, durata del blocco, durata della sessione, «Ricordami» in giorni (0: l'opzione non compare). |
| **Quote** | **Quote dei nuovi tenant** (spazio, persone, elementi; vuote: nessun limite), **Capacità della piattaforma** con quanto è dato ai tenant e quanto usano (un avviso quando si dà più di quanto la piattaforma ha), i tenant con le loro quote. Le quote proprie di un tenant sono nella sua pagina (Dati › Quote: **Personalizza**, **Ripristina**). |
| **Chiavi dei servizi esterni** | Le chiavi che paga la piattaforma, per i servizi che dichiarano i plugin installati (ognuna dice quali plugin la usano; nessun plugin, nessun servizio). Una chiave condivisa la usano tutti i tenant che non ne hanno una propria. Dopo il salvataggio si vedono solo le ultime quattro cifre. La chiave di un servizio che nessun plugin installato usa più è segnata come non usata: rimuovila. |
| **Incorporamento** | I siti che possono mostrare le pagine pubbliche (link pubblici) dentro le loro pagine. Senza siti, nessuno può. |
| **Backup e ripristino** | Vedi *Backup* più sotto. |
| **Manutenzione** | Vedi *Manutenzione* più sotto. |
| **Identità e aspetto** | **Identità e testi**, **Tema e modo**, **Lingue e formati**, **Barra in alto** (sotto). |

### Identità e aspetto

- **Identità e testi**: **Nome** (barra in alto, pagina di accesso, titolo del browser), **Testo di
  benvenuto**, **Piè di pagina**, **Informativa privacy**, **Note legali**, **Guida** (un indirizzo che Aiuto ›
  Guida di Mosaikit apre al posto delle guide incluse nella shell, nella lingua della persona), loghi per
  sfondi chiari e scuri e **Icona del browser** (SVG, PNG o WebP, al massimo 512 KB). I tenant ereditano i
  testi.
- **Tema e modo**: **Tema predefinito** (per la piattaforma, la pagina di accesso e i tenant che non ne
  scelgono uno), **Nuovo tema** (l'editor dei temi: colore principale, barra in alto, grigi, verifiche di
  contrasto, **Correggi per me**; **Salva il tema** resta spento finché qualcosa non si legge), **Temi che i
  tenant possono usare**, **I tenant possono scegliere il proprio tema**, la tonalità predefinita.
- **Layout**: dove stanno navigazione, barra, selettore del tenant e azioni, per tutti (non c'è una scelta
  personale). Integrati: **Teams** (barra di icone, il predefinito) e **Console**; altri dai plugin di layout
  (Workspace, Suite, Project, Tabs, in **Plugin** › Layout). **Layout che i tenant possono scegliere** limita
  ciò che si offre ai Tenant Manager (nessuno spuntato: tutti; il layout della piattaforma è sempre ammesso).
  Ogni layout mantiene i punti di riferimento, il link «Vai al contenuto» e l'ordine della tastiera. Un plugin
  di layout spento o rimosso: la piattaforma torna a Teams.
- **Stile**: **Angoli**, **Densità**, **Carattere**, **Schede**, **Pulsanti principali** e **Immagine della
  barra**, con ogni layout e tema; senza un valore vale il predefinito del layout. La pagina mostra la modifica
  prima di **Salva**. L'immagine della barra è un PNG di al massimo 512 KB; il colore della barra la scurisce
  quanto serve perché i testi si leggano a 4,5:1, e un'immagine troppo chiara anche così viene rifiutata. Anche
  i tenant possono personalizzare lo stile.
- **Lingue e formati**: **Lingue offerte** (con una sola lingua il menu della lingua sparisce), **Lingua
  predefinita**, **Formato di date e numeri**.
- **Barra in alto**, uguale per tutti i tenant, con un'anteprima: **Logo e nome dell'applicazione**,
  **Cerca**, **Lingua**, **Aiuto**, **Tonalità (chiaro, scuro, automatico)**. Spenti: il pulsante della
  sidebar prende il posto del logo; la ricerca e `Ctrl K` spariscono; la lingua si sceglie in Account; tour,
  guida e novità passano nel menu della persona; vale la tonalità predefinita. Campanella, menu della persona
  e selettore del tenant restano sempre.

### Backup

**Sistema › Backup e ripristino**.

- **Backup**: il database, i contenuti, i plugin e ogni tenant, in uno zip nella cartella dei dati, con un
  `README.txt`. La chiave dei segreti non è dentro: conservala a parte. **Esegui ora**; ogni backup mostra
  quando è partito, l'**Esito** (**completo**, **solo i tenant** con il motivo, **non riuscito**), la
  dimensione e i tenant; **Scarica**, **Elimina il backup**.
- **Pianificazione**: **Backup pianificati** una volta al giorno all'**Ora (UTC)**, **Backup conservati**
  (quelli più vecchi vengono eliminati).
- **Ripristina un tenant**: da un backup, un tenant torna com'era allora (chiede prima di sostituirne uno che
  esiste).
- **Ripristina un elemento**: scegli il tenant, cerca per **Titolo**, **App** o **Proprietario**; lo **Stato**
  dice se l'elemento è ancora nel tenant. Torna con quello che contiene e i suoi file; seleziona **Anche le
  sue condivisioni con le persone e i gruppi che esistono ancora** se le vuoi; i link pubblici non tornano
  mai. Se l'elemento esiste ancora, scegli **Come copia** (un nuovo elemento accanto a quello attuale) o **Al
  posto di quello attuale** (la versione attuale viene eliminata definitivamente). Il proprietario riceve una
  notifica.
- **Ripristinare tutto** si fa a server fermo: lo spiega il `README.txt` dentro ogni backup.
- Un backup è *solo i tenant* quando non c'è un `pg_dump` utilizzabile per la versione del database
  (PostgreSQL); l'immagine Docker include gli strumenti del client. Un backup non riuscito avvisa tutti gli
  Administrator.

### Manutenzione

**Sistema › Manutenzione**.

- **Modalità manutenzione** accesa: tutti vedono l'**Avviso per tutti**, accedono e lavorano solo gli
  Administrator, i link pubblici sono chiusi. Una barra gialla ricorda che è accesa.
- **Manutenzione programmata**: un **Inizio** e un **Avviso in anticipo**, mostrato a tutti prima; all'ora
  stabilita la modalità manutenzione si accende da sola. **Annulla la manutenzione programmata** la toglie.

## Monitoraggio

**Monitoraggio**, sezioni:

| Sezione | Cosa |
|---|---|
| **Stato** | Ogni servizio (database, archivio dei contenuti, email, lavori in background, runtime dei plugin, backup, i provider di identità dei tenant OIDC) con il suo stato, la versione e la risposta. |
| **Prestazioni** | Richieste ed errori, tempo di risposta (p50, p95, p99), sessioni ed email in attesa in **1 ora**, **12 ore**, **7 giorni**; **Mostra come tabella**. |
| **Errori** | Errori del server e tasso di errore; le ultime operazioni rifiutate con **Vedi nel registro**. |
| **Tenant** | Richieste, persone, elementi, spazio e la **Quota più vicina** di ogni tenant. |
| **Capacità** | Disco dei dati, memoria del server, database, contenuti, memoria di Mosaikit. |
| **Avvisi** | **Avvisi in corso** e le **Condizioni**: disco libero sotto una percentuale, errori del server oltre una percentuale, email non riuscite in un'ora, un backup non riuscito, un servizio che non risponde; **Chi li riceve** (nessuno scelto: tutti gli Administrator). Un superamento viene notificato una volta, finché la condizione non rientra. |

## Registro

**Registro**: gli eventi di tutti i tenant, con la colonna **Tenant** e il suo filtro, gli stessi filtri,
pannello laterale ed esportazione CSV del registro del Tenant Manager. L'**Attività** di una persona li
mostra ovunque.
