# Pacchetto e firma

Come un plugin diventa un pacchetto `.mskp` che un Administrator può installare. Architettura da §8.5 a §8.8 e §10.
Versione inglese: [../packaging.md](../packaging.md).

## Il pacchetto

```
mosaikit-plugin pack [dir] [--key file] [--release] [--out cartella] [--no-build]
```

`pack` compila logica e UI, valida, firma e valida il risultato: `dist/<id>-<versione>.mskp`. Il predefinito è una
compilazione debug della logica; usare `--release` per ciò che si distribuisce.

Un `.mskp` (versione 3) è uno zip con:

| File | Cosa |
|---|---|
| `plugin.toml` | il manifesto |
| `logic.wasm` | la logica (facoltativa) |
| `ui/**` | la UI compilata (`ui/dist` della cartella) |
| `migrations/NNN_name.sql` | le migrazioni |
| `media/**`, `layout/**`, `lang/**` | schermate, un layout, un pacchetto lingua, dove il tipo li ha |
| `MANIFEST.sha256` | l'hash di ogni file |
| `SIGNATURE` | JSON `{ key, sig }`: la chiave pubblica e la firma ed25519 di `MANIFEST.sha256` |

Limiti: il pacchetto al massimo 64 MiB, un file al massimo 64 MiB, 256 MiB decompresso, 5000 file; percorsi sicuri su ogni
piattaforma; nomi di migrazione `NNN_name.sql`, nessun numero duplicato; ogni schermata nominata nel manifesto deve stare in
`media/`.

## Chiavi

```
mosaikit-plugin keygen --out publisher.key     # stampa la chiave pubblica; non sovrascrive mai un file esistente
mosaikit-plugin sign file.mskp --key other.key # firma di nuovo, o firma un pacchetto non firmato (--out per tenere l'originale)
```

La chiave usata da `pack` e `sign` è, in ordine: `--key <file>`, `MOSAIKIT_SIGNING_KEY` (base64),
`MOSAIKIT_SIGNING_KEY_FILE`, altrimenti una chiave di sviluppo che lo strumento crea una volta per utente
(`%APPDATA%\mosaikit\signing.key`, `~/.config/mosaikit/signing.key`). Tenere la chiave privata fuori da ogni repository;
alla CI dare il base64 in un segreto.

## Chiavi fidate

Un server installa un pacchetto solo se la firma è valida e la **chiave pubblica è fidata**. L'Administrator aggiunge alla
configurazione la chiave pubblica dell'editore (quella che ha stampato `keygen`):

```toml
# mosaikit.toml
trusted_keys = ["<chiave pubblica ed25519 in base64>"]
```

oppure `MOSAIKIT_TRUSTED_KEYS="chiave1, chiave2"`. Revocare un editore è togliere la chiave. Un pacchetto non firmato
richiede `allow_unsigned = true`, che è solo per lo sviluppo e segnala il pacchetto; il profilo sviluppatore lo imposta.
Gli errori sono `unsigned package` e `publisher key not trusted: <chiave>`.

## Installare

- L'Administrator: Plugin › **Installa da file**, oppure dal catalogo.
- Tu, su un server di prova: `mosaikit-plugin install file.mskp --server http://localhost:8080 --user admin --password …
  [--totp codice]` (`MOSAIKIT_ADMIN_USER`, `MOSAIKIT_ADMIN_PASSWORD`). L'indirizzo porta il suo percorso base se il server
  ne ha uno.

All'installazione l'host ricalcola ogni hash, controlla la firma e la blocklist, controlla `[requires]` rispetto alla
propria versione e API, applica le migrazioni in una transazione e, se qualcosa fallisce, annulla tutto.

## Versioni e aggiornamenti

`version` è `MAJOR.MINOR.PATCH`. Installare una versione più nuova conserva lo stato del plugin, le sue impostazioni e le
scelte delle organizzazioni; le sue nuove migrazioni girano nella stessa transazione dell'aggiornamento. **Un downgrade è
rifiutato** (`downgrade not allowed`). Un plugin caricato da una cartella in sviluppo non si può installare sopra
(`is loaded in development mode`). Dichiarare `[requires] mosaikit` e `api` perché l'Administrator veda perché un
aggiornamento non va bene (`plugin_incompatible`; Plugin › Aggiornamenti mostra il motivo).

La disinstallazione mostra prima ciò che sparisce (elementi, organizzazioni, estensioni che smettono di funzionare), poi
rimuove schema, elementi, file, impostazioni e segreti del plugin.

## L'indice del registro `index.json`

Un catalogo dei plugin di cui l'installazione si fida, impostato con `registry = "registry/index.json"` nella
configurazione (la release ne porta una copia per le installazioni offline). Serve a installare da una fonte fidata,
controllare l'integrità, mostrare gli aggiornamenti e revocare versioni.

```json
{
  "plugins": [
    { "id": "com.acme.notes", "name": "Notes", "description": "…", "icon": "…",
      "versions": [
        { "version": "0.3.0", "file": "plugins/com.acme.notes-0.3.0.mskp", "sha256": "…", "publisher": "<chiave base64>",
          "notes": "cosa cambia", "kind": "app", "extends": null, "mosaikit": ">=1.0, <2", "api": 1 }
      ] }
  ],
  "blocklist": [ { "id": "com.acme.notes", "version": "0.2.0", "sha256": null, "reason": "perdita di dati" } ]
}
```

`file` è relativo alla cartella di `index.json`. `notes` (testo semplice) viene da `RELEASE.md` del plugin quando la build
del repository crea l'indice; l'elenco Aggiornamenti mostra le note delle versioni più nuove di quella installata.
`mosaikit` e `api` copiano `[requires]`, così il catalogo può segnalare una versione che non si può installare.

**Blocklist.** Una voce nomina un plugin, una `version` (se manca: tutte) e facoltativamente un `sha256`, con un `reason`.
Un pacchetto bloccato è rifiutato all'installazione (`<id> <versione> is in the blocklist of the registry`); è la
revoca di una versione compromessa.

## Lista di controllo della release

1. `mosaikit-plugin test` (validate --strict, test della logica e della UI).
2. Alzare `version`; scrivere le note (`RELEASE.md`).
3. `mosaikit-plugin pack --release --key <chiave dell'editore>`.
4. Installare su un server sviluppatore, e sul kit Docker quando si usano funzioni di PostgreSQL.
5. Pubblicare il `.mskp` e il suo `sha256`; comunicare la chiave pubblica all'Administrator.
