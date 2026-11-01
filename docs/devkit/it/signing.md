# Firma dello sviluppatore

Come un autore di plugin ottiene una chiave di firma, come un Administrator la rende fidata, cosa fare se una chiave si
perde o viene compromessa. Formato del pacchetto e controllo di fiducia: [Pacchetto e firma](packaging.md).
Versione inglese: [../signing.md](../signing.md).

## 1. Creare una chiave (lo sviluppatore)

```
mosaikit-plugin keygen --out publisher.key
```

Il comando scrive la chiave privata in `publisher.key` (non sovrascrive mai un file) e stampa la **chiave pubblica**
(ed25519, base64). Si invia la chiave pubblica agli Administrator che installeranno i plugin; mai la privata. Si tiene
`publisher.key` fuori da ogni repository: una chiave persa non si recupera, si sostituisce (sezione 4). In CI si mette
la chiave privata in base64 nel segreto `MOSAIKIT_SIGNING_KEY` e si esegue `mosaikit-plugin pack`.

## 2. Firmare

```
mosaikit-plugin pack --key publisher.key
mosaikit-plugin sign dist/x.mskp --key publisher.key --out dist/x.signed.mskp
mosaikit-plugin validate dist/x.mskp
```

## 3. Rendere fidato un editore (l'Administrator)

Un server di produzione installa solo pacchetti firmati con una chiave fidata. L'Administrator aggiunge la chiave
pubblica dell'editore alla configurazione e riavvia:

```toml
# mosaikit.toml
trusted_keys = ["<chiave dei pacchetti ufficiali>", "<chiave pubblica dell'editore>"]
```

oppure, in Docker, `MOSAIKIT_TRUSTED_KEYS="chiave1,chiave2"` nel file `.env`. Prima di aggiungerla si verifica che la
chiave arrivi dall'editore per un altro canale rispetto al pacchetto. Si lascia nell'elenco la chiave dei pacchetti
ufficiali. Un pacchetto firmato con un'altra chiave è rifiutato (`publisher key not trusted`), uno non firmato con
`unsigned package`.

## 4. Revocare un editore o una chiave

| Caso | Cosa fare |
|---|---|
| Editore non più fidato o chiave compromessa | Togliere la chiave da `trusted_keys` e riavviare: installazioni e aggiornamenti firmati con essa sono rifiutati. Ciò che è già installato non viene rimosso: si disinstalla, oppure si bloccano le versioni con la `blocklist` del registro |
| Una versione è difettosa | Aggiungerla alla `blocklist` del registro e pubblicare una versione corretta |
| Chiave persa | Fare una nuova chiave, far aggiungere la chiave pubblica nuova, ripubblicare i plugin (stesso `id`, `version` più alta), poi togliere la vecchia |
| Rotazione programmata | Aggiungere la nuova chiave, pubblicare le versioni successive con essa, togliere la vecchia quando non serve più |

## La chiave del kit

Gli archivi del kit sono firmati con la chiave dei pacchetti ufficiali (file `trusted_key.txt` del kit);
`mosaikit-plugin self-update` rifiuta una release non firmata da una chiave fidata. Non è una chiave di editore per i
vostri plugin. Dettagli: [../releasing.md](../releasing.md) (in inglese).
