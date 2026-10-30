# Novità

Cosa cambia da una versione di Mosaikit alla successiva. La shell mostra la sezione della sua versione in
Aiuto › Novità (un titolo `## <versione>` per versione, voci `- `, gruppi `### `). Questo file è la
versione italiana di [CHANGELOG.md](CHANGELOG.md): tenerli allineati.

## 1.0.0

### La shell

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
- Ogni tabella funziona allo stesso modo, nella shell e nelle app: la riga delle intestazioni resta ferma e scorrono solo le righe, i titoli delle colonne ordinano, un campo di filtro nell'intestazione cerca in ogni campo e altre righe si caricano quando si arriva in fondo. I plugin installati si vedono anche come schede (predefinito) o come tabella. La stessa tabella è usata dentro schede e finestre (i dati sotto i grafici, l'importazione da CSV e i suoi esiti, gli elementi di un backup, le estensioni di un plugin); le matrici dei permessi, i tipi di notifica e la capacità delle quote restano griglie ma con lo stesso aspetto, con riga delle intestazioni e prima colonna sempre in vista.
- In Contatti, Attività e Note il pannello con i dettagli compare solo quando apri un elemento o ne crei uno nuovo; altrimenti l’elenco usa tutta la larghezza.
- Le note sono post-it colorati: otto colori (leggibili in modo chiaro e scuro), scelti nell’editor o da un piccolo menu sulla nota, leggermente inclinati e dritti sotto il puntatore. Trascina l’angolo piegato, oppure premi Alt e i tasti freccia, per ridimensionare un post-it; la dimensione viene ricordata. La vista Elenco resta disponibile.
- Le note hanno tag tuoi, ciascuno con il proprio colore: creali, rinominali, cambia il colore ed eliminali dal pulsante Tag (eliminare un tag lo toglie dalle tue note), e filtra le note per tag.
- Le pagine e gli elenchi vuoti mostrano un’illustrazione con un titolo, una riga di spiegazione e i pulsanti di cosa fare, uguali nella shell (Tenant, Plugin, Gruppi, Richieste di accesso, Condivisioni, Cestino, Notifiche) e nelle app; un filtro senza risultati mostra un piccolo messaggio con il link per azzerarlo.
- Documenti: l'elenco e il pannello dei dettagli sono un unico blocco piatto; la barra dei file selezionati mostra solo le icone (il nome compare come tooltip); il pannello non scorre più in orizzontale; i PDF si vedono nel pannello e nel visualizzatore grazie all'app stessa, quindi funzionano in ogni browser. Le barre di scorrimento sono sottili come quelle di Mosaikit in tutte le app.

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

- Un plugin può chiamare un servizio esterno con la chiave impostata da un Administrator: `http.fetch` accetta una `key` (un servizio di `[[service_keys]]`) e l'host la aggiunge come bearer token; l'indirizzo può essere quello impostato in Chiavi dei servizi esterni (`address = true`). Le richieste dei plugin passano dalla stessa protezione dell'anteprima delle pagine (solo indirizzi pubblici). L'SDK ha `ctx.http().fetch_with_key(...)`.
- Note traduce una nota con un servizio di traduzione (Traduci la nota, sotto la nota), come esempio.
- I pulsanti distruttivi dei plugin (Elimina) restano ben leggibili in modalità scura, come nella shell. Note 0.5.0 mostra nell'intestazione la pagina aperta (Note › Le mie note).
- La brochure del manifest (descrizione, immagini, autore, licenza, link) appare come pagina completa nel dettaglio del plugin; i plugin ufficiali ora hanno immagini e testi.

- `mountCrud` può disegnare da sé gli elementi (`views`: elenco, schede o bacheca, con un selettore) accanto a un pannello di dettaglio e a un pannello di lettura (`reader`); `avatar`, `chip` ed `el` sono funzioni condivise.
- La logica di un plugin conosce i gruppi della persona che la chiama (`ctx.groups`).
- La logica può notificare la persona che la chiama, o le persone che vedono uno dei suoi elementi,
  con la nuova operazione `notify` dell'host (`[permissions] notify = true`, `ctx.notify` nell'SDK).

### La piattaforma

- Gli Administrator hanno un'email obbligatoria e unica. La cambiano da Account (password attuale e secondo fattore); nome ed email di un altro Administrator si cambiano da Sistema › Administrator.
- Sistema › Email dice che cosa manca e come configurarla, con un'impostazione pronta per un server di prova locale (Mailpit nell'ambiente di sviluppo).

- Tenant con un periodo di prova, archiviati o eliminati, esportati e importati di nuovo.
- Backup ogni giorno, con il ripristino di un tenant intero o di un singolo elemento.
- Modalità manutenzione, anche programmata, con un avviso per tutti.
- Monitoraggio di servizi, prestazioni, errori e capacità, con avvisi.
- Una nuova lingua è un plugin: una volta installato compare nei menu delle lingue. Il plugin dello spagnolo ora traduce tutta l'interfaccia e i testi di ogni plugin ufficiale.
