# Mosaikit — Piano di realizzazione del mockup

Dal mockup (`docs/mockup`) e dalle regole di [refactoring-ui.md](refactoring-ui.md) al prodotto. Ogni fase
comprende kernel, migrazioni (PostgreSQL e SQLite), test del kernel e del server, API, pagine della nuova
shell (`ui/host/src/next`), test e2e (Playwright, `cargo xtask e2e`) e cita gli id delle schermate del
mockup. Una fase è chiusa quando `cargo xtask test` e gli e2e passano.

| Fase | Contenuto | Schermate |
|---|---|---|
| 0. La shell diventa il prodotto | Il prototipo sostituisce la UI attuale; libreria per le lingue; errori del server come codici traducibili; e2e e controllo di accessibilità (axe); watcher di sviluppo su Windows | tutte |
| 1. Impostazioni a tre livelli | Valore della piattaforma e del tenant, tipo (gestita, con un limite, personalizzabile), «i tenant possono personalizzarla»: identità e testi con i loghi, regole della password, sessioni, lingue e formati, chiavi dei servizi esterni (cifrate), incorporamento | `system/*`, `config/*` |
| 2. Notifiche | Notifiche nel kernel (lette, non lette), campanella in tempo reale, preferenze per tipo e canale, email (SMTP), `msk.notify` per i plugin | `inbox`, `account/notifications`, `system/email` |
| 3. Persone e permessi | Tutte le persone (Administrator), In attesa (inviti e richieste di accesso), profili di permesso, permessi per plugin, riepiloghi in sola lettura | `gusers`, `members/*`, `person/*`, `group/*`, `module` |
| 4. Plugin | Manifest con `kind`, `extends` e icona; disponibile (Administrator) e attivo (Tenant Manager); scheda Estensioni; aggiornamenti | `marketplace/*`, `mpmod/*`, `splugins` |
| 5. Condivisioni, Cestino, Registro | Tutte le condivisioni e «Condivisi da me»; cestino con 30 giorni e ripristino; Registro con filtri, CSV e dettaglio | `shares`, `trash`, `activity`, `audit` |
| 6. Quote e consumi | Quote predefinite e capacità, quote per tenant, comportamento al limite, consumi, avvisi, Account › Consumi | `system/quotas`, `usage/*`, `account/usage` |
| 7. Ciclo di vita e operazioni | Archiviare ed eliminare un tenant, logo, prova; backup e ripristino, conservazione, manutenzione; Monitoraggio | `tenant/*`, `system/*`, `monitoring/*` |
| 8. Accesso OIDC per tenant | Configurazione per tenant, identità esterne, fonte dei ruoli, revoca (architettura §15) | `tenant/sign-in`, `login` |
| 9. Ricerca, aiuto, temi | Ricerca nei contenuti con i plugin; tour, guida, novità, scorciatoie; alto contrasto; editor dei temi con verifica WCAG | `dlg-search`, `themeedit` |

Ordine: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. La fase 8 si può anticipare se serve a un cliente.

## Stato

| Fase | Stato |
|---|---|
| 0 | da fare |
| 1 | da fare |
| 2 | da fare |
| 3 | da fare |
| 4 | da fare |
| 5 | da fare |
| 6 | da fare |
| 7 | da fare |
| 8 | da fare |
| 9 | da fare |
