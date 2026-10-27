# Mosaikit — Guida per il Tenant Manager

Il Tenant Manager gestisce un tenant: le sue persone, i gruppi e i permessi, quali plugin sono attivi, le
condivisioni, i consumi e le impostazioni che la piattaforma lascia personalizzare al tenant. Tutto quello
che una persona fa nelle app è in [user.md](user.md); il lato della piattaforma è in
[administrator.md](administrator.md).

Un Tenant Manager ha tutti i permessi in tutti i plugin attivi nel tenant.

## La tua sidebar

- **Panoramica del tenant**: i numeri del tenant (membri e ospiti, utenti attivi negli ultimi 30 giorni,
  elementi, condivisioni e link pubblici, app) e un pannello **Consumi**.
- **App**: le app del tenant, come per tutti.
- **Gestione del tenant**: **Gestisci**, **Plugin**, **Condivisioni**, **Consumi**, **Registro**.
- **Impostazioni del tenant** in fondo.

Le pagine di Gestione del tenant sono riservate: chi altro ne apre l'indirizzo legge *Riservato ai Tenant
Manager*.

## Gestisci

Sezioni: **Persone**, **Gruppi**, **Profili di permesso**, **In attesa**.

### Persone

La tabella mostra ogni persona con **Ruolo e profilo**, gruppi, **Stato** e **Ultimo accesso**; gli ospiti
sono segnati come *ospite*.

- **Per invitare una persona di un altro tenant**: **Invita persone**, l'azione principale di Persone (vedi
  sotto).
- **Per creare una persona** (tenant con account locali): **Nuovo utente** → **Utente**, **Nome
  visualizzato**, **Email** (obbligatoria: la persona recupera la password a quell'indirizzo), **Password
  iniziale**, **Ruolo** → **Crea utente**. Ogni account locale ha un indirizzo email; anche nell'**Importa da
  CSV** la colonna `email` è obbligatoria. Gli account creati prima di questa regola possono non averlo:
  mostrano «Email mancante» e la prossima modifica della persona lo richiede. Con un provider di identità (OIDC)
  **Nuovo utente** non c'è: le persone le crea il provider al loro primo accesso.
- Le persone cambiano da sé nome e immagine in Account › Profilo; tu vedi qui la modifica. L'email la cambi
  tu, nella scheda **Profilo**.
- **Per agire su più persone**: selezionale; compare la barra **Azioni sulla selezione** con **Rendi Tenant
  Manager**, **Rendi User**, **Cambia profilo**, **Aggiungi a un gruppo**, **Sospendi**.
- **La pagina di una persona** (clic sul nome) ha le schede:
  - **Profilo**: **Ruolo**, **Profilo di permesso**, gruppi, nel tenant dal, ultimo accesso.
  - **Accesso**: **Invia il link per la password** (un link che vale una volta, da copiare e dare alla
    persona; arriva anche per email se l'account ha un indirizzo), le **Sessioni** aperte con **Chiudi** e
    **Chiudi tutte le sessioni**. Per un ospite password e sessioni le gestisce il suo tenant di
    appartenenza.
  - **Permessi**: cosa può fare la persona in ogni plugin e da dove arriva (profilo, gruppo, permesso
    personale); **Perché non vede un elemento?** controlla un elemento dal suo identificativo, passo per
    passo.
  - **Attività**: i suoi ultimi eventi, con **Vedi tutto nel registro**.
- Il menu **⋯** di una persona: **Invia il link per la password**, **Reimposta la password**, **Sospendi nel
  tenant** / **Riattiva nel tenant**, **Rimuovi dal tenant**.
- **Per rimuovere una persona**: **Rimuovi dal tenant** chiede **Chi riceve i suoi N elementi**; i suoi
  elementi passano a quella persona con le loro condivisioni. Per un ospite l'account resta nel suo tenant
  di appartenenza; per una persona che appartiene a questo tenant l'account viene disattivato.
- Una persona sospesa non entra nel tenant; i suoi dati restano.

### Invitare una persona di un altro tenant

**Gestisci › Persone › Invita persone** (anche in **In attesa**): **Invita una persona di un altro
tenant**, scegli il suo tenant di **Appartenenza**, il suo **Utente** lì, **Ruolo**, **Profilo di
permesso** → **Invia l'invito**. Entra come ospite: continua ad accedere dal suo tenant e accetta dalla
campanella. Gli inviti in sospeso sono in **Inviti**, con **Revoca**.

### Gruppi

I gruppi servono a condividere con più persone insieme e a dare permessi a molte persone.

- **Nuovo gruppo** → **Nome** → **Crea gruppo**.
- La pagina di un gruppo: **Membri** (**Aggiungi un membro**, togli), **Elementi condivisi**, **Plugin**
  (cosa aggiunge il gruppo al profilo dei suoi membri), **Attività**; **Elimina il gruppo** revoca le
  condivisioni con il gruppo.
- I gruppi segnati **Dal provider di identità** arrivano dal provider del tenant: solo il provider ne cambia
  i membri, e qui non si possono eliminare.

### Profili di permesso

Un profilo di permessi è un insieme di permessi nei plugin con un nome, per esempio *Lettore* o *Redattore*.
Dai un profilo a ogni persona: è ciò che può fare in ogni plugin e il suo punto di partenza. Gruppi e
permessi personali aggiungono, non tolgono mai. I Tenant Manager hanno ogni permesso, qualunque sia il
profilo. Ogni tenant ha il profilo *Standard*. Ogni scheda dice in quanti plugin il profilo dà accesso e li
elenca (aperta subito se sono pochi), con nomi e permessi dei plugin nella tua lingua.

- **Nuovo profilo** → **Nome** e **Descrizione** → **Crea il profilo** (parte con i permessi predefiniti di
  ogni plugin).
- Il menu di un profilo: **Rinomina** (nome e descrizione), **Modifica i permessi** (una riga compatta per
  plugin, con un filtro quando sono tanti), **Duplica**, **Usa per i nuovi inviti** (lo rende il
  **Profilo predefinito**), **Elimina** (i suoi membri prendono il profilo predefinito).
- I permessi standard di ogni plugin sono **Usare l'app**, **Creare elementi**, **Eliminare elementi**,
  **Condividere elementi**; un plugin può dichiararne altri.

### In attesa

- **Richieste di accesso**: persone che hanno chiesto di vedere o modificare un elemento. **Approva**,
  **Rifiuta**, oppure **Inoltra al proprietario** (decide il proprietario). La persona riceve una notifica
  con la risposta.
- **Inviti**: mandati e non ancora accettati.

## Plugin

**Gestione del tenant › Plugin** elenca i plugin che l'Administrator ha reso disponibili al tenant, con il
loro tipo (**App**, **Servizio**, **Estensione**) e la versione.

- **Acceso** attiva o spegne un plugin per tutti nel tenant. Le app compaiono nella sidebar, i servizi
  lavorano dietro le quinte, le estensioni aggiungono campi, azioni o schede a un altro plugin.
- Spegnere un plugin spegne anche le sue estensioni (una conferma le elenca); un'estensione dice **Attiva
  prima …** finché il suo plugin è spento. Mentre un plugin è spento i suoi link pubblici non funzionano.
- **Accesso e permessi** apre la tabella del plugin: cosa significa ogni permesso, una riga per **Profilo**
  con le caselle, e **Gruppi e persone** (**Aggiungi un gruppo o una persona**) per i permessi oltre il
  profilo. **Salva** compare solo dopo una modifica.
- Quando l'Administrator rende un plugin disponibile o non disponibile, ricevi una notifica.

## Condivisioni

**Gestione del tenant › Condivisioni** elenca gli elementi condivisi nel tenant.

- Pillole **Condivisi**, **Pubblici e link**, **Tutti gli elementi**; filtri per proprietario, app e
  titolo.
- Seleziona gli elementi → **Revoca condivisioni e link**: spariscono tutte le condivisioni e i link
  pubblici, i proprietari tengono i loro elementi.
- **⋯ › Riassegna gli elementi di una persona**: tutti gli elementi di una persona passano a un'altra, con
  le loro condivisioni.
- Se **Impostazioni del tenant › Condivisione** nasconde i titoli ai Tenant Manager, vedi solo numeri e
  dimensioni.

## Consumi

**Gestione del tenant › Consumi**, sezioni:

| Sezione | Cosa |
|---|---|
| **Quote** | Spazio, persone ed elementi, ognuno con una barra, in sola lettura (**Gestita dall'Administrator**): *Al limite: …* dice cosa si ferma; con un consumo in crescita, quando si arriva al limite al ritmo degli ultimi 30 giorni. |
| **Andamento** | Un grafico per quota con la linea del limite; **Mostra come tabella**. |
| **Chi consuma di più** | **Per persona**, **Per gruppo** (chi è in due gruppi conta in entrambi), **Per app**. |
| **Attività** | L'attività degli ultimi giorni; lo spazio include *di cui nel cestino*. |
| **Avvisi** | **Quando avvisare**: **All'80%**, **Al 100%**, **Previsione**; **Chi li riceve**: **I Tenant Manager del tenant**, più le persone e i gruppi che aggiungi. |

Al limite non si cancella niente: si fermano le aggiunte (nuovi file, persone o elementi). Gli elementi nel
cestino contano finché non vengono eliminati definitivamente. Sopra l'80% compare un avviso in fondo alla
sidebar di tutti nel tenant. Le quote le cambia solo l'Administrator.

## Registro

**Gestione del tenant › Registro**: cosa è successo nel tenant — chi, cosa, su cosa, quando, esito.

- **Tutto** / **Solo gli errori** (accessi rifiutati, operazioni rifiutate), filtri **Chi**, **Cosa**, **Su
  cosa**, **Periodo**, ricerca.
- Fai clic su un evento: un pannello laterale con i dettagli (indirizzo, browser…), **Solo <persona>** e
  **Solo questo elemento**.
- **Esporta i selezionati** o **Esporta tutto in CSV**; **Eventi precedenti** carica i successivi.
- Gli stessi eventi compaiono nella scheda **Attività** di una persona e di un gruppo.

Vedi solo gli eventi del tuo tenant.

## Cestino del tenant

Il tuo **Cestino** (menu della persona) mostra tutto il cestino del tenant, con la colonna **Proprietario**:
puoi ripristinare o eliminare definitivamente gli elementi di tutti. **Svuota il cestino** toglie solo
quello che possiedi o hai eliminato.

## Impostazioni del tenant

Valgono per tutti nel tenant. Ogni impostazione mostra da dove arriva il suo valore:

- **Ereditato**: il valore della piattaforma. **Personalizza** per dare al tenant un valore suo.
- **Personalizzato**: il valore del tenant. **Ripristina** torna a quello della piattaforma.
- **Minimo della piattaforma: N** / **Massimo della piattaforma: N**: il tenant può solo essere più severo.
- Un lucchetto e **Gestita dall'Administrator**: sola lettura (anche quando l'Administrator non lascia
  personalizzare quell'impostazione ai tenant).

**Salva** compare solo dopo una modifica.

| Sezione | Cosa decidi |
|---|---|
| **Condivisione** | Link pubblici accesi o spenti, durata massima dei link, se i Tenant Manager vedono i titoli degli elementi. |
| **Password e sessioni** | Lunghezza minima della password, tentativi prima del blocco, durata del blocco e della sessione, «Ricordami» — solo più severi della piattaforma. |
| **Chiavi dei servizi esterni** | Le chiavi che paga il tenant, per i servizi che usano i plugin installati (ognuna dice quali plugin la usano); una chiave condivisa la usano tutti nel tenant, una non condivisa solo i Tenant Manager. Dopo il salvataggio si vedono solo le ultime quattro cifre. La chiave di un servizio che nessun plugin usa più è segnata come non usata: rimuovila. |
| **Incorporamento** | I siti che possono mostrare le pagine pubbliche del tenant, tra quelli ammessi dalla piattaforma. |
| **Notifiche** | Le impostazioni predefinite delle email di notifica per le persone del tenant. |
| **Identità e aspetto** | **Identità e testi** (nome, testo di benvenuto, piè di pagina, privacy e note legali, guida, **Pagina di arrivo**, loghi per sfondi chiari e scuri), **Tema e modo** (il tema del tenant tra quelli offerti, **Nuovo tema** con l'editor dei temi se permesso, tonalità predefinita), **Lingue e formati** (le lingue offerte, tra quelle della piattaforma, e quella predefinita). |
| **Gestito dalla piattaforma** | Sola lettura: il metodo di accesso (account locali o il provider di identità del tenant), le quote e le altre regole che decide l'Administrator. |

Il nome e il logo del tenant compaiono nella barra in alto delle sue persone e nella sua pagina di accesso
(`#/login/<tenant>`).

### Layout e stile

**Layout** e **Stile** (in Identità e aspetto) seguono le stesse regole delle altre impostazioni: ereditati
dalla piattaforma, oppure personalizzati dal tenant. Ti vengono offerti i layout che l'Administrator ammette;
la scelta vale per tutte le persone del tenant. **Stile** imposta angoli, densità, carattere, schede, pulsanti
principali e un'immagine della barra (PNG, scurita quanto serve perché i testi si leggano; una troppo chiara
viene rifiutata), con anteprima prima di **Salva**. **Ripristina** torna alla piattaforma.

### L'editor dei temi

**Nuovo tema** (se la piattaforma lascia scegliere il tema ai tenant): un **Nome**, il **Colore principale**,
la **Barra in alto** (nel colore principale, scura o chiara) e i **Grigi** (neutri, caldi, freddi). Le
anteprime mostrano chiaro e scuro; **Si legge?** elenca le verifiche di contrasto. **Correggi per me**
sistema quello che non si legge; **Salva il tema** resta spento finché tutto si legge. Un tema creato per il
tenant si può modificare ed eliminare; quando viene eliminato il tenant torna al tema della piattaforma.

## Accesso del tenant

Come accedono le persone del tenant lo decide l'Administrator: account locali (utente e password gestiti da
Mosaikit) o il provider di identità del tenant (OIDC), mai entrambi. Lo vedi in **Impostazioni del tenant ›
Gestito dalla piattaforma**. Con il provider di identità:

- le persone vengono create al loro primo accesso, non ci sono **Nuovo utente** né il link per la password;
- i ruoli arrivano da Mosaikit (li dai tu) oppure dai gruppi del provider;
- i gruppi del provider possono comparire in **Gruppi**, segnati **Dal provider di identità**.
