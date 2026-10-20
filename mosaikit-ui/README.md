# mosaikit-ui

Front-end React + TypeScript + Vite di Mosaikit (login, icon bar plugin,
vista CRUD generica, gestione plugin). Viene servito embedded dal
`mosaikit-server` tramite `rust-embed` (cartella `dist/` compilata).

## Comandi

    npm install        # una tantum
    npm run dev        # dev server con HMR su http://localhost:5173
                       # (proxy di /api /login /logout /plugins /resources su :8080)
    npm run build      # build di produzione in dist/ (serve al server per embeddare)
    npm run lint       # controllo TypeScript/eslint

Il server Rust deve girare su :8080 (`cargo run` in `../mosaikit-server`,
con `cargo watch` per il hot restart). In dev conviene lavorare su
**:5173** (HMR istantaneo); quando il server Rust si riavvia la pagina si
ricarica da sola (poll su `/api`, solo in modalità dev di Vite).

## Struttura

    src/api.ts            client REST (401 → logout automatico)
    src/types.ts          tipi API (plugin, campi, righe)
    src/App.tsx           sessione + routing schermate
    src/components/       Login, IconRail, StatusBar, CrudView,
                          FieldInput, PluginManager, ConfirmDialog, ...
