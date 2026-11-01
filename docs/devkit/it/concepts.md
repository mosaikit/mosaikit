# Concetti

Cosa deve sapere della piattaforma chi scrive un plugin. Il testo completo è in [../../architecture.md](../../architecture.md)
(§3 organizzazioni e ruoli, §4 risorse, §8 plugin). Versione inglese: [../concepts.md](../concepts.md).

## Organizzazioni (tenant) e ruoli

Un **tenant** (nell'interfaccia italiana, l'organizzazione) è uno spazio di lavoro con persone, dati e impostazioni
propri. Tre ruoli:

| Ruolo | Ambito | In breve |
|---|---|---|
| Administrator | l'installazione | installa i plugin, li rende disponibili alle organizzazioni, non vede mai i contenuti; accede da una pagina propria |
| Tenant Manager | un'organizzazione | persone, gruppi, profili di permesso, accende i plugin e ne imposta i permessi; vede i metadati, mai i contenuti |
| Utente | un'organizzazione | crea elementi, li condivide, usa ciò che gli è condiviso |

Un plugin gira per un **chiamante** in un'**organizzazione**: ogni chiamata porta l'utente, l'organizzazione e i
permessi di quella persona. Un plugin non vede mai un'altra organizzazione e non gira mai come servizio anonimo.

## Risorse, proprietà e condivisione

Ogni elemento che un plugin conserva (una nota, un'attività, un file) è una **risorsa** del kernel: organizzazione,
plugin, tipo, titolo, proprietario e, volendo, un genitore. Proprietà e condivisione le gestisce il kernel, non il
plugin:

| Livello | Valore | Consente |
|---|---|---|
| lettura | 1 | vedere l'elemento e il suo contenuto |
| scrittura | 2 | modificarlo, creare figli |
| gestione | 3 | condividere, revocare, link pubblici, spostare, eliminare |

Il proprietario ha la gestione. I permessi si danno a utenti e gruppi dell'organizzazione; il livello effettivo è il più
alto tra l'elemento e i suoi antenati. La finestra di condivisione è dell'host: la UI la apre con `msk.share(id)`.
Ogni riga di una tabella di un plugin è protetta dalla row level security con queste regole ([Dati](data.md)), quindi una
query restituisce solo ciò che il chiamante vede.

Una riga del CRUD di un plugin ha `my_level` (`read`, `write`, `manage`), `owner_id`, `owner_name`, `shared`,
`parent_id`, `created_at`, `updated_at`.

## Permessi

Ogni plugin ha quattro permessi standard, applicati dal kernel: `use`, `create`, `delete`, `share`. Un rifiuto è un
`403` con codice `missing_permission`. Il manifesto può aggiungerne di propri con `[[user_permissions]]`, applicati dal
plugin (`ctx.can("export")` nella logica, `msk.can("export")` nella UI). Un Tenant Manager può fare tutto; le altre
persone hanno i permessi del loro **profilo di permesso**, più eventuali concessioni. I permessi non allargano mai ciò
che una persona vede: l'accesso agli elementi resta quello dell'ACL.

Un plugin deve anche essere **acceso**: l'Administrator lo rende disponibile all'organizzazione, il Tenant Manager lo
accende. Un plugin spento risponde `404` con codice `plugin_off`.

## Impostazioni su tre livelli

| Livello | Chi | Nel plugin |
|---|---|---|
| Piattaforma | l'Administrator | le impostazioni `[[config]]` (Plugin › Configurazione), lette nella logica con `ctx.setting("key")`; i segreti sono cifrati |
| Organizzazione | il Tenant Manager | i permessi del plugin, se è acceso |
| Personale | ogni persona | le chiavi di servizi esterni (`[[service_keys]]`), le scelte di notifica |

Le chiavi di servizi esterni esistono in tre ambiti (`platform`, `tenant`, `personal`); `ctx.service_key("id")` restituisce
quella in uso per il chiamante: la sua, altrimenti quella dell'organizzazione, altrimenti quella della piattaforma.

## Tipi di plugin

| Tipo | Cosa | Codice |
|---|---|---|
| `app` | pagine proprie; nella barra laterale e nella Home | logica e UI |
| `service` | lavora dietro le quinte: logica, hook, KPI | logica |
| `extension` | aggiunge campi, azioni e schede a un altro plugin | manifesto, logica e UI facoltative |
| `layout` | dispone gli slot della shell | file dichiarativi, mai codice |
| `language` | una lingua dell'interfaccia | testi, mai codice |

Le regole di ciascuno sono nel [Riferimento del manifesto](manifest.md); vedi anche
[Estensioni e layout](extensions-layouts.md).

## Cosa può fare un plugin

- Dichiarare risorse (campi) e ottenere dalla piattaforma tabella, CRUD, ricerca, condivisione, cestino e KPI.
- Eseguire logica Rust come WebAssembly: hook prima di creare o modificare e dopo l'eliminazione, e comandi che chiamano la
  UI o un altro plugin. Gira nella stessa transazione dell'operazione; un errore annulla tutto.
- Interrogare il proprio schema con SQL controllato dalla guardia, con il ruolo del plugin e la row level security.
- Chiedere di più all'host solo se il manifesto lo dice: notifiche (`notify`), lettura dell'area File come il chiamante
  (`files_read`), chiamate ad altri plugin (`calls`), origini web esterne (`network`, `frame_src`), codice a runtime
  (`script_eval`).
- Disegnare una UI in un iframe che parla con l'host tramite il bridge.

## Cosa non può fare un plugin

- Leggere le tabelle di un altro plugin o lo schema `core`; chiamare SQL fuori dalla lista consentita.
- Indicare i destinatari di una notifica, rileggere un segreto, raggiungere la rete fuori dalle origini dichiarate.
- Eseguire codice nella shell, leggerne cookie o storage: la UI vive su un'origine non fidata ([Sicurezza](security.md)).
- Cambiare la piattaforma o un'altra organizzazione, o fare lavoro illimitato: istruzioni, memoria e dimensione dei
  messaggi sono limitate ([Riferimento della logica](logic.md)).

## La plugin API

Il contratto tra un plugin e il kernel ha un numero, la **plugin API** (ora 1). Il plugin dice per quale è stato costruito
e con quali versioni di Mosaikit funziona in `[requires]`; il kernel rifiuta ogni altra. Un elemento deprecato resta per
una versione maggiore. Parte della superficie è **sperimentale** (architettura §8.11; elenco in
[Changelog e compatibilità](changelog.md)).
