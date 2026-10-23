# Mosaikit — Guida per chi lavora in un tenant

Questa guida è per chiunque acceda a un tenant per lavorare con le sue app. Quello che fanno il Tenant
Manager e l'Administrator è in [tenant-manager.md](tenant-manager.md) e [administrator.md](administrator.md).

Le etichette sono quelle dell'interfaccia italiana; quella inglese ha gli stessi posti.

## Accesso

1. Apri l'indirizzo di Mosaikit.
2. In **Tenant** scegli il tuo tenant (è già scelto quando ce n'è uno solo, o quando l'indirizzo finisce
   con `#/login/<tenant>`).
3. Poi, secondo il tenant:
   - **Utente** e **Password**, poi **Accedi**. **Ricordami su questo dispositivo** ti tiene dentro per
     alcuni giorni (quanti lo decide l'Administrator; l'opzione può mancare).
   - oppure **Accedi con …** (il provider di identità della tua organizzazione): la password la chiede il
     provider, mai Mosaikit. Torni dentro già autenticato.
4. Troppe password sbagliate bloccano l'accesso di quell'account per alcuni minuti.

**Ospite in altri tenant.** Accedi sempre al tuo tenant di *appartenenza*. Se sei stato invitato in altri
tenant, passa dall'uno all'altro con il nome del tenant in alto a sinistra: il cambio non chiede un nuovo
accesso.

**Password dimenticata.** Chiedi al Tenant Manager del tuo tenant di appartenenza: ti manda un link per
sceglierne una nuova. Il link vale una volta sola e per un tempo limitato (pagina **Scegli una nuova
password**).

**Lingua e tonalità** si scelgono già nella pagina di accesso (in alto a destra).

## La shell

| Dove | Cosa |
|---|---|
| **Sidebar** (a sinistra) | **Home** e le app che puoi usare. Il pulsante in cima alla barra la apre o la chiude (solo icone, oppure icone e nomi). |
| **Tenant** (in alto a sinistra) | Il tenant in cui sei; se ne hai più d'uno, un menu per cambiare (**Appartenenza**, **Ospite in**). |
| **Cerca** (in alto al centro) | Pagine, app e gli elementi che puoi vedere. Anche con `Ctrl K` o `/`. |
| **Lingua**, **Tonalità** | La lingua dell'interfaccia; tonalità chiara, scura o automatica e **Alto contrasto**. |
| **Aiuto** (?) | **Tour guidato di questa pagina**, **Guida di Mosaikit**, **Novità della versione …**, **Scorciatoie da tastiera**. Un pallino sul pulsante indica che c'è un tour di questa pagina da vedere. |
| **Campanella** | Le tue notifiche (vedi sotto). |
| **Menu della persona** (il tuo nome) | **Account**, **Notifiche**, **Richieste di accesso**, **Cestino**, **Esci**. |

Alcuni di questi possono mancare: cosa mostra la barra in alto lo decide l'Administrator. Quando **Aiuto**
non è nella barra, le sue voci sono nel menu della persona.

**Quando il server non risponde** (un aggiornamento, un riavvio) la pagina dice *Il server non risponde.
Riprovo…* e torna da sola.

## Home

La **Home** mostra il tuo spazio (**Elementi tuoi**), **Condivisi da me**, **Condivisi con me**, **Miei link
pubblici attivi** e le app del tenant.

- **Condivisi da me** elenca cosa hai condiviso, con chi e quanti link pubblici. **Revoca tutto** toglie
  ogni condivisione e link pubblico di un elemento (l'elemento resta tuo).

## App ed elementi

Ogni app si apre nella shell (Note, Attività, Contatti, File, Mappe, Siti statici… secondo il tenant). Cosa
puoi fare in un'app dipende dal tuo **profilo di permesso**: alcune persone possono solo leggere, altre
anche creare, eliminare o condividere. Quando qualcosa non è permesso, l'app lo dice.

Alcuni elementi hanno campi, pulsanti o schede in più aggiunti da un'**estensione** (per esempio *Revisione
delle note* aggiunge *Revisionata*, *Segna come revisionata* e una scheda **Revisione** alle note).

Quando una quota del tenant è esaurita, le app rifiutano nuovi elementi o file e lo dicono; non viene
cancellato niente.

## Condividere un elemento

Apri l'elemento nella sua app e scegli **Condividi**.

1. **Persone e gruppi del tenant**: cerca una persona o un gruppo, scegli il **Livello** e **Condividi**.
   - **Visualizzazione**: vede il contenuto.
   - **Modifica**: modifica il contenuto.
   - **Gestione**: condivide, sposta, elimina.
2. **Con chi è condiviso** elenca chi ha accesso; cambia il livello o **Revoca**.
3. **Link pubblico (sola lettura)**: un link che chiunque può aprire senza accedere. Facoltativi **Scadenza
   (giorni)** e **Password (facoltativa)**, poi **Crea link**. *Il link si vede solo adesso*: copialo
   subito. L'elenco **Link pubblici** mostra quando è stato creato, quando scade e le visite; **Revoca** lo
   chiude. Se il tenant ha spento i link pubblici, la finestra lo dice.
4. **Proprietà**: cedi l'elemento a un'altra persona (**Trasferisci**).

Le persone fuori dal tenant devono prima essere invitate dal Tenant Manager.

La persona con cui condividi riceve una notifica con il link all'elemento.

## Chiedere l'accesso a un elemento

Se apri l'indirizzo di un elemento che non puoi vedere, la pagina dice **Non puoi vedere questo elemento**.

1. Scegli **Visualizzazione** o **Modifica** in **Accesso**, scrivi un **Messaggio (facoltativo)**.
2. **Invia la richiesta**.

Decide il proprietario, o un Tenant Manager; ricevi una notifica con la risposta. Quando è approvata, lo
stesso indirizzo apre l'elemento.

Se possiedi elementi, le richieste degli altri arrivano nella campanella; menu della persona › **Richieste
di accesso** apre **Richieste di vedere o modificare i tuoi elementi**: **Approva** o **Rifiuta**.

## Notifiche

La campanella mostra un numero quando arriva qualcosa di nuovo (inviti, condivisioni, richieste di accesso,
avvisi, messaggi delle app), senza ricaricare la pagina.

- Nel pannello: **Accetta** / **Rifiuta** un invito, **Segna tutte come lette**, l'ingranaggio (preferenze)
  e **Vedi tutte**.
- **Vedi tutte** apre la pagina **Notifiche**: **Tutte** / **Non lette**, **Tipo**, **Periodo**, ricerca;
  seleziona le righe per **Segna come letta**, **Segna come da leggere** o **Elimina**.

Quali notifiche arrivano anche **per email** si sceglie in **Account › Notifiche**.

## Cestino

Quello che elimini va nel **Cestino** (menu della persona), non sparisce subito.

- Ci resta per un certo numero di giorni (30, se l'Administrator non l'ha cambiato), poi viene eliminato
  definitivamente.
- Finché è nel cestino nessuno lo vede e i suoi link pubblici non funzionano.
- **Ripristina** lo riporta indietro con le sue condivisioni, i link pubblici e i file.
- **Elimina definitivamente** e **Svuota il cestino** non si possono annullare.
- Vedi quello che possiedi o che hai eliminato; il Tenant Manager vede tutto il cestino del tenant.

Gli elementi nel cestino contano nelle quote del tenant finché non vengono eliminati definitivamente.

## Account

Menu della persona › **Account**. Sezioni:

| Sezione | Cosa trovi |
|---|---|
| **Profilo** | La tua **Immagine** (SVG, PNG o WebP, al massimo 512 KB: la vedono le persone dei tuoi tenant) e il tuo **Nome visualizzato**, che cambi tu; utente e tenant di appartenenza. L'email la cambia il Tenant Manager del tuo tenant di appartenenza. In un tenant che accede con un provider di identità il nome arriva dal provider. |
| **Accesso e sicurezza** | **Cambia password** (attuale, nuova, ripeti; sotto il campo si vede la regola del tenant). Cambiarla chiude le altre sessioni. In un tenant che accede con un provider di identità qui non c'è la password: la gestisce il provider. |
| **Notifiche** | **Cosa ricevo**: per ogni tipo, nell'app e per **Email** (**Mai**, **Subito**, **Un riepilogo al giorno**); il tuo **Indirizzo email**. |
| **Aspetto e lingua** | **Tonalità** (**Chiaro**, **Scuro**, **Automatico (come il sistema)**), **Alto contrasto**, **Lingua**, **Sidebar** (**Aperta all'avvio**) e **App nella sidebar** (quelle tolte restano nella Home e nella ricerca). Il tema lo sceglie chi gestisce il tenant. |
| **I miei tenant** | Il tuo tenant di appartenenza e i tenant in cui sei ospite, con il tuo ruolo; **Apri** uno. |
| **Consumi** | **Elementi tuoi** e lo spazio che usi; **Quanto resta nel tenant** quando il tenant ha delle quote. |
| **Chiavi** | Le tue chiavi personali dei servizi esterni usati dai plugin installati (ognuna dice quali plugin la usano): valgono solo per te, e dopo il salvataggio si vedono solo le ultime quattro cifre. |

Le tue preferenze ti seguono su ogni dispositivo.

## Ricerca

Premi `Ctrl K` o `/` (oppure fai clic sulla casella di ricerca) e scrivi.

- I risultati sono raggruppati: **Tutto**, **Pagine**, **App** e una pillola per ogni app con il numero di
  risultati.
- Gli elementi si trovano dal titolo e dal testo dei campi, anche dall'inizio di una parola.
- Trovi solo quello che puoi vedere: gli elementi non condivisi con te, quelli nel cestino e le app spente
  non compaiono.
- Frecce per spostarti, `Invio` per aprire, `Esc` per chiudere. Con il campo vuoto: **Ricerche recenti**.

## Scorciatoie da tastiera

Fuori dai campi in cui si scrive (`?` mostra l'elenco):

| Tasti | Cosa fa |
|---|---|
| `Ctrl` `K` o `/` | Cerca ovunque |
| `?` | Scorciatoie da tastiera |
| `G` poi `H` | Vai alla Home |
| `G` poi `N` | Vai alle notifiche |
| `G` poi `A` | Vai al tuo account |
| `G` poi `T` | Vai al cestino |

## Accessibilità

- L'interfaccia segue le WCAG 2.1 AA: funziona con la tastiera e con i lettori di schermo, e ogni tema è
  verificato per il contrasto.
- **Alto contrasto** (Account › Aspetto e lingua, oppure il menu della tonalità nella barra in alto) scurisce
  testi e bordi, ispessisce l'indicatore del fuoco e sottolinea i link, con ogni tema; anche le app lo
  seguono.
- Il **Tour guidato di questa pagina** (Aiuto) spiega le pagine principali passo per passo; funzionano
  **Avanti**, **Indietro**, **Salta il tour**, le frecce e `Esc`.
