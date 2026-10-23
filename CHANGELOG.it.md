# Novità

Cosa cambia da una versione di Mosaikit alla successiva. La shell mostra la sezione della sua versione in
Aiuto › Novità (un titolo `## <versione>` per versione, voci `- `, gruppi `### `). Questo file è la
versione italiana di [CHANGELOG.md](CHANGELOG.md): tenerli allineati.

## 1.0.0

### La shell

- Una nuova interfaccia per ogni ruolo, in italiano e in inglese, con modo chiaro, scuro e automatico.
- La barra in alto la decide l'Administrator: logo e nome, ricerca, lingua, aiuto e modo.
- Temi: Mosaikit, Italia e Tessera, più i temi creati con l'editor dei temi, verificati per il contrasto
  (WCAG 2.1 AA). Alto contrasto per chi legge con fatica.
- Ricerca ovunque: pagine, app e gli elementi delle app che puoi vedere (Ctrl K).
- Aiuto: un tour guidato delle pagine principali, la guida, le novità e le scorciatoie da tastiera.

### Persone e tenant

- Impostazioni su tre livelli: la piattaforma, il tenant e ogni persona. Ogni impostazione dice se è
  ereditata, personalizzata o gestita dalla piattaforma.
- Persone e permessi: profili di permesso, gruppi, inviti di persone di altri tenant e richieste di
  vedere o modificare un elemento, decise dal proprietario o da un Tenant Manager.
- Una password dimenticata si sostituisce con un link che vale una volta sola.
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

### La piattaforma

- Tenant con un periodo di prova, archiviati o eliminati, esportati e importati di nuovo.
- Backup ogni giorno, con il ripristino di un tenant intero o di un singolo elemento.
- Modalità manutenzione, anche programmata, con un avviso per tutti.
- Monitoraggio di servizi, prestazioni, errori e capacità, con avvisi.
