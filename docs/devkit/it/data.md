# Dati

Dove un plugin tiene i suoi dati, e le regole che la piattaforma applica. L'architettura §7 ha il testo completo.
Versione inglese: [../data.md](../data.md).

## Due backend, un solo insieme di regole

| | PostgreSQL ≥ 15 | SQLite |
|---|---|---|
| Usato da | server e Docker | la versione desktop e `mosaikit-plugin dev` |
| Tabelle del plugin | schema `plg_<id>` | tabelle `plg_<id>__<nome>` |
| Protezione | ruoli e row level security nel database | le stesse regole applicate dal livello dati |
| `plugin.call`, `[requires] database = "postgres"` | sì | no |

Si scrive SQL per PostgreSQL. Su SQLite viene **tradotto** (nomi, cast, `now()`, intervalli, `= ANY(...)`, `ILIKE`,
`json_build_object`, `string_agg`, `EXTRACT`, i `to_char` e `date_trunc` più comuni, segnaposto `$n`); un costrutto senza
equivalente sicuro è rifiutato con un messaggio chiaro (`json_agg` di righe intere, `DISTINCT ON`, espressioni regolari,
`ALTER COLUMN TYPE`). `validate --strict` fa passare le migrazioni da quella traduzione, così lo si scopre prima del
desktop. Un plugin che ha bisogno di funzioni di PostgreSQL dice `[requires] database = "postgres"`; allora non si installa
su SQLite. Si controlla sul database vero con il kit Docker.

## Tabelle

Le tabelle delle `[[resources]]` le genera l'host dal manifesto. Altre tabelle o viste vengono dalle migrazioni. **Ogni
tabella** di un plugin deve avere:

```sql
resource_id uuid not null,   -- la risorsa del kernel a cui appartiene la riga
tenant_id   uuid not null    -- default core.ctx_tenant() nelle tabelle generate
```

Dopo le migrazioni l'host aggiunge la chiave esterna verso `core.resources` con `on delete cascade`, attiva la RLS e crea
le policy. Se a una tabella manca una colonna, l'installazione viene annullata.

## Migrazioni

File `migrations/NNN_name.sql`, applicati in ordine all'installazione e all'aggiornamento, **nella stessa transazione**:
se un'istruzione fallisce, si annulla tutto.

- Numerate da `001`, senza buchi né duplicati; il nome dopo il numero è minuscolo, cifre e `_`.
- **Una migrazione applicata non si modifica mai**: se ne conserva il checksum e una modifica è rifiutata
  (`migration <nome> differs from the one already applied`). La modifica va in una nuova migrazione. In sviluppo gli
  Strumenti sviluppatore offrono di cancellare i dati del plugin e ripartire dalla prima migrazione.
- Le migrazioni solo aggiungono: `validate --strict` rifiuta `drop table`, `drop column` e `truncate`, perché non esiste
  uno script di ritorno.
- Consentito dalla guardia: `CREATE TABLE/INDEX/VIEW`, `ALTER TABLE`, `DROP TABLE/INDEX/VIEW` (la validazione rifiuta
  quelli irreversibili), `INSERT/UPDATE/DELETE`, `COMMENT`. Rifiutati: funzioni, trigger, policy, `GRANT`, `SET`/`RESET`,
  `DO`, `COPY` e qualsiasi riferimento a un altro schema.
- Girano con il ruolo del plugin (`SET LOCAL ROLE`), quindi non possono toccare `core` né altri plugin. Le viste che usano
  oggetti fuori dallo schema del plugin sono rifiutate.
- Le viste KPI si chiamano `kpi_*`, hanno `tenant_id` e sono dichiarate in `[[kpi]]`; la vista dichiarata deve esistere dopo
  le migrazioni o l'installazione fallisce (`the KPI view <nome> declared in the manifest does not exist`).
- Le estensioni PostgreSQL richieste (`[requires] extensions`) devono essere installate nel database; il loro schema è
  aggiunto al `search_path` del ruolo dopo quello del plugin.
- Aggiungere un campo a una risorsa aggiunge la colonna all'aggiornamento; un campo esistente non può cambiare tipo.

```sql
-- migrations/001_kpi.sql
create view kpi_notes_by_tag as
  select tenant_id, coalesce(tag, '(none)') as tag, count(*) as notes
  from notes group by tenant_id, coalesce(tag, '(none)');
```

## Il contesto di sicurezza

Ogni operazione sui dati di un plugin gira in una transazione su una connessione autenticata come **il ruolo del plugin**
(`<prefisso>_p_<id>`: solo DML sul proprio schema, nessun accesso a `core` se non tramite funzioni):

1. l'host esegue `core.set_ctx(secret, user, tenant, plugin, link)`, una funzione `SECURITY DEFINER` che controlla un
   segreto che il plugin non può leggere e memorizza il contesto per la transazione corrente;
2. esegue le istruzioni (CRUD generico, comandi, hook);
3. commit, o rollback se qualcosa fallisce.

Il plugin non può falsificare il contesto (non conosce il segreto) né uscire dal suo ruolo. Su SQLite il contesto vive sul
lato Rust della connessione e l'SQL non può cambiarlo.

## Row level security

Per ogni tabella l'host crea policy, così una query restituisce e modifica solo ciò che il chiamante può:

| Policy | Regola |
|---|---|
| lettura | la risorsa della riga è visibile al chiamante a livello 1 o più (appartenenza, proprietà, permessi ereditati, link pubblico) |
| inserimento | `core.can_access(resource_id, 2)` e `tenant_id` è l'organizzazione del contesto |
| modifica | livello di scrittura (2) |
| eliminazione | livello di gestione (3) |

Si scrive `select * from notes` e si ottengono le righe del chiamante. Un Tenant Manager vede i metadati, mai il contenuto;
e il plugin non può sottrarsi. Dentro l'SQL si può leggere `core.visible_resources` (i metadati degli elementi visibili di
questo plugin) e chiamare `core.can_access(id, level)`, `core.level_of(id)`, `core.ctx_user()` e `core.ctx_tenant()`.

Le liste del CRUD sono paginate per chiave (`limit` predefinito 50, al massimo 500; il cursore è la chiave dell'ultima
riga), e `sort` è una lista consentita di campi dichiarati.

## Cosa consente la guardia SQL a runtime

Le query della logica (`ctx.db().query/exec`) passano dalla guardia, una **seconda** difesa dopo il ruolo e la RLS:

- solo `SELECT`, `INSERT`, `UPDATE`, `DELETE` (e `WITH`);
- un'istruzione per chiamata;
- niente `SET`, niente funzioni di sistema (`pg_*`, `set_config`, `current_setting`, `dblink`, `lo_*`, funzioni di export
  XML…), nessun altro schema salvo `core.visible_resources` e le funzioni `can_access`, `level_of`, `ctx_user`,
  `ctx_tenant`;
- le istruzioni girano come prepared statement con un timeout di 15 s su PostgreSQL.

La guardia restituisce l'SQL serializzato di nuovo dal suo parse: ciò che è stato analizzato è ciò che gira. Un'istruzione
rifiutata è l'errore `invalid SQL: …`, `statement not allowed in plugins: …`, `object not accessible to plugins: …` oppure
`function not allowed in plugins: …`.

## Mai da un plugin

Leggere le tabelle di un altro plugin o `core`; creare ruoli, policy o trigger; cambiare la proprietà di un oggetto. Per
usare i dati di un altro plugin se ne chiamano i comandi (`calls`): applica le sue regole per lo stesso utente.
