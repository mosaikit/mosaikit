# Mosaikit — Kit di sviluppo dei plugin

Documenti per chi scrive, collauda, firma e distribuisce un plugin per Mosaikit, senza il codice sorgente della
piattaforma. Sono scritti sul codice (parser del manifesto, SDK, pacchetto della UI, strumento a riga di comando) e
seguono la plugin API 1. Versione inglese: [../README.md](../README.md).

Si parte da [Per iniziare](getting-started.md), poi si legge il riferimento che serve.

| Documento | Per |
|---|---|
| [Per iniziare](getting-started.md) | Installare il kit, fare un primo plugin, il ciclo di sviluppo |
| [Concetti](concepts.md) | Organizzazioni (tenant), ruoli, proprietà e condivisione, risorse, impostazioni, cosa può e non può fare un plugin |
| [Riferimento del manifesto](manifest.md) | Ogni campo di `plugin.toml`, con la sua regola; i cinque tipi |
| [Riferimento della logica](logic.md) | ABI, comandi, hook, operazioni dell'host, errori, limiti, `MockHost` |
| [Riferimento della UI](ui.md) | Client `Msk`, `mountCrud`, `gridTable`, `emptyState`, `pageHead`, tema, i18n, accessibilità |
| [Dati](data.md) | Migrazioni su PostgreSQL e SQLite, il contesto di sicurezza, RLS, la guardia SQL |
| [Sicurezza](security.md) | Origini e CSP, permessi, cosa è firmato, segreti, contenuti non fidati |
| [Estensioni e layout](extensions-layouts.md) | Estendere un altro plugin; scrivere un layout o un pacchetto lingua |
| [Linee guida della UI](ui-guidelines.md) | Le regole della shell che valgono per le pagine dei plugin |
| [Pacchetto e firma](packaging.md) | `.mskp`, chiavi, chiavi fidate, blocklist, versioni, aggiornamenti, l'indice del registro |
| [Firma dello sviluppatore](signing.md) | Creare una chiave, rendere fidato un editore, revocare una chiave |
| [Rilasciare il kit](../releasing.md) | Archivi del kit, verifica di un download, `self-update`, `cargo install`, registro privato (solo in inglese) |
| [Test](testing.md) | Test unitari, `validate --strict`, `@mosaikit/plugin-testing`, ricette per la CI |
| [Risoluzione dei problemi](troubleshooting.md) | Gli errori che restituiscono il kernel e gli strumenti, con causa e rimedio |
| [Changelog e compatibilità](changelog.md) | Versioni di kit, piattaforma, SDK e API della UI; deprecazioni |

**Esempi.** `mosaikit-plugin new <nome> --example todo|insights|note-priority` crea un plugin completo e commentato con
un `WALKTHROUGH.md` (sorgente: `crates/plugin-cli/templates/examples`).

**Dove sta la verità.** L'architettura della piattaforma è [../../architecture.md](../../architecture.md) (§8 plugin,
§8.11 plugin API 1, §8.12 profilo sviluppatore), in inglese. Questi documenti ripetono ciò che serve a chi scrive un
plugin e rimandano lì per il resto. Dove una funzione non ha ancora un esempio ufficiale è segnata come
*sperimentale*: l'API 1 non promette che resti com'è (architettura §8.11).

**Riferimento delle API generato dai sorgenti** (`cargo doc -p mosaikit-plugin-sdk --no-deps` e TypeDoc su
`ui/plugin-api`): lo pubblica con il kit la fase di impacchettamento del piano; questi documenti sono scritti a mano.

Piano del kit: [../../plugin-devkit-plan.md](../../plugin-devkit-plan.md).
