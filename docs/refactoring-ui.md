# Mosaikit — Refactoring dell'interfaccia

Decisioni approvate per riorganizzare la shell, valide per il mockup (`docs/mockup`, in inglese) e per
la nuova shell (`ui/host/src/next`, in italiano). Obiettivo: che chi usa Mosaikit sappia sempre dove si
trova e dove trovare ogni cosa.

## 1. Regola: ogni cosa ha una sola casa

- **Lavoro**, nella sidebar: panoramica e app.
- **Gestione dell'ambito**, nella sidebar, solo per Tenant Manager (il tenant) e Administrator (la
  piattaforma).
- **Personale**, nel menu della persona: Account, Notifiche, Cestino, Esci.

Altrove compaiono solo scorciatoie che portano alla casa, mai un secondo punto in cui modificare la
stessa cosa.

## 2. Navigazione

| Ruolo | Sidebar |
|---|---|
| Utente | Home · le app |
| Tenant Manager | Panoramica del tenant · le app · gruppo «Gestione del tenant»: Gestisci (persone e gruppi), Plugin, Condivisioni, Consumi, Registro · in fondo: Impostazioni del tenant |
| Administrator | Panoramica della piattaforma · Tenant · Persone · Plugin · Monitoraggio · Registro · in fondo: Sistema |

- **Menu della persona**: Account, Notifiche, Cestino (non per l'Administrator), Esci. Impostazioni e
  Sistema stanno solo nella sidebar; la pagina Account non ha un secondo «Esci».
- **Campanella**: apre un pannello con le ultime notifiche, «Segna tutte come lette», un ingranaggio verso
  Account › Notifiche e «Vedi tutte» verso la pagina Notifiche. Le notifiche sono nella prima versione.
- **Account** (una pagina sola, sezioni a sinistra): Profilo · Accesso e sicurezza (cambio della propria
  password, secondo fattore, sessioni, token personali) · Notifiche (cosa ricevo, su quale canale) ·
  Aspetto e lingua (modo, contrasto, lingua, sidebar) · I miei tenant (casa, ospite, «Lascia») ·
  Consumi (Utente e Tenant Manager: il proprio consumo e quanto resta nel tenant) · Chiavi (le chiavi
  personali dei servizi esterni; non per l'Administrator).
- **Aiuto** (?) nella barra: tour guidato della pagina, guida, novità della versione, scorciatoie, versione.

## 3. Accorpamenti

- **Gestisci › Persone**: Persone · Gruppi · Profili di permesso · In attesa (inviti e richieste di
  accesso, con il contatore). Un solo «Nuovo profilo».
- **Permessi dei plugin**: si modificano solo nella pagina del plugin del tenant. Gruppo › Plugin e
  Persona › Permessi sono riepiloghi in sola lettura con «Modifica nei permessi del plugin». Niente
  eccezioni nell'invito.
- **Plugin e tenant**: l'Administrator rende un plugin *disponibile* a un tenant (Plugin › Tenant); il
  Tenant Manager lo *attiva* e ne decide i permessi. Il dettaglio del tenant mostra l'elenco con il link.
- **Registro**: stesso nome e stesso componente per tutti; l'Administrator ha in più il filtro per tenant.
- **Aspetto del tenant o della piattaforma**: solo in Impostazioni o Sistema › Identità e aspetto, con le
  schede Identità e testi · Tema e modo · Lingue e formati (e, nel Sistema, Barra in alto). La tavolozza
  in alto contiene solo le preferenze personali.

## 4. Plugin: un solo nome

Il termine è **Plugin** per tutti i ruoli, come nel codice e nel pacchetto per gli sviluppatori («modulo»
in italiano vuol dire anche *form*). Il tipo è un'etichetta del plugin:

| Tipo | Cosa fa | Dove si vede |
|---|---|---|
| App | ha pagine proprie | nella sidebar e nella Home |
| Servizio | lavora dietro le quinte | solo nell'elenco dei plugin |
| Estensione | estende un altro plugin (campi, azioni, schede) | dentro il plugin che estende, «Estende: Note» |

Il dettaglio di un plugin ha la scheda **Estensioni** (quelle installate e quelle disponibili). Chi lavora
ogni giorno vede le **App**.

I plugin ricevono **lingua, tema e modo** all'avvio (handshake del bridge) e a ogni cambio (evento), anche
quando il pulsante corrispondente della barra è nascosto.

## 5. Impostazioni ereditate: tre tipi

| Tipo | Esempi | Aspetto al livello sotto |
|---|---|---|
| Gestita dalla piattaforma | modo di autenticazione e provider, quote, plugin disponibili, barra in alto | sola lettura con lucchetto e «Gestita dall'Administrator» |
| Con un limite | regole della password, durata delle sessioni, lingue (sottoinsieme), conservazione | modificabile, «Minimo della piattaforma: 10»; i valori oltre il limite sono rifiutati |
| Personalizzabile | identità e testi, tema e modo predefinito, formati, chiavi dei servizi esterni | «Ereditato» con «Personalizza»; poi «Personalizzato» con «Ripristina» |

Nel Sistema un'impostazione personalizzabile può avere l'interruttore «I tenant possono personalizzarla».

## 6. Quote

- **Administrator**: Sistema › Quote (quote predefinite dei nuovi tenant e capacità totale, con avviso se
  la somma delle quote assegnate la supera); nel dettaglio del tenant le quote del tenant (Ereditato o
  Personalizzato). Unico punto in cui si modificano.
- **Tenant Manager**: Consumi, con le quote del tenant in sola lettura, andamento, chi consuma di più,
  avvisi (configurabili).
- **Utente**: Account › Consumi, il proprio consumo e quanto resta nel tenant. Non ci sono quote per
  persona. In sidebar solo un avviso vicino al limite, non un riquadro fisso.

## 7. Barra in alto

Sistema › Identità e aspetto › **Barra in alto**, decisa solo dall'Administrator e valida per tutti i
tenant, con l'anteprima. Interruttori:

| Elemento | Se è spento |
|---|---|
| Logo e nome dell'applicazione | il pulsante della sidebar prende il posto del logo, anche sul telefono |
| Ricerca | spariscono la casella e Ctrl K; resta la ricerca nelle pagine |
| Lingua | si sceglie in Account › Aspetto e lingua (il pulsante sparisce comunque con una sola lingua) |
| Guida | tour, guida e novità passano nel menu della persona |
| Tonalità (chiaro, scuro, automatico) | vale il modo predefinito; la persona lo cambia in Account |

Campanella, menu della persona e selettore del tenant restano sempre (il selettore sparisce da solo con un
solo tenant).

## 8. Glossario

| Usare | Al posto di |
|---|---|
| Tenant | Organizzazione (Organization) |
| Tenant Manager | Manager |
| Plugin (tipi: App, Servizio, Estensione) | Moduli, Marketplace |
| Account (pagina personale) · Profilo di permesso | Profilo, con tre significati |
| Impostazioni del tenant · Sistema | Config, Configurazione |
| Home (Utente) · Panoramica del tenant · Panoramica della piattaforma | tre «Overview» |
| Registro | Activity log, Audit log |
| Accesso · Provider di identità (OIDC) | SSO, single sign-on, Keycloak |

Gli id delle schermate del mockup restano stabili anche quando cambiano le etichette (README del mockup):
le schermate nuove hanno id nuovi, quelle tolte restano come ritirate.

## 9. Pagine

- Struttura fissa: breadcrumb, titolo con il badge di stato, una sola azione primaria a destra, le altre e
  il cambio di stato nel menu «⋯».
- Elenco delle sezioni a sinistra per le pagine di impostazioni (Account, Impostazioni, Sistema,
  Gestisci); schede orizzontali per il dettaglio di un oggetto (persona, gruppo, tenant, plugin).
- Barra «Modifiche non salvate · Annulla · Salva» solo quando qualcosa è cambiato.
- Pannello laterale per un'occhiata (riga del registro, servizio), pagina per modificare.
- Barra delle azioni sulla selezione solo con una selezione.
- L'Administrator ha un segnale stabile di trovarsi nella piattaforma (badge «Piattaforma» nella barra).
- Le azioni delle panoramiche portano alla casa giusta (Condivisioni, Plugin), non a un avviso.

## 10. Da aggiungere

- Cambio della propria password (Account › Accesso e sicurezza).
- Condivisioni: per il Tenant Manager la pagina con il filtro «Pubblici» e «Revoca»; per l'Utente
  «Condivisi da me» nella Home.
- Dettaglio del tenant per l'Administrator: logo in sola lettura, «Archivia» ed «Elimina» in un'area
  separata in fondo.

## 11. Testi da allineare

- Password: minimo 10 caratteri (piattaforma, come nel kernel); blocco dopo 8 tentativi falliti in 15 minuti (come nel kernel).
- Account locali in Mosaikit (argon2id); OIDC per i tenant che lo scelgono; mai entrambi.
- Administrator: password locale e secondo fattore (TOTP), mai tramite un tenant.
- Nessun riferimento ai piani.
- Profili di permesso in Gestisci, non in Impostazioni.
