// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * The languages of the shell (MK-027). The texts are written in English in the code and looked up
 * here; a text without a translation stays in English, so that a missing one never breaks a page.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];

const ITALIAN: Record<string, string> = {
  // Sign-in and registration
  'All the apps of your organization, in one place.':
    'Tutte le app della tua organizzazione, in un solo posto.',
  'One sign-in for every app': 'Un solo accesso per tutte le app',
  'Your data stays in your organization': 'I tuoi dati restano nella tua organizzazione',
  'On any device, accessible to everyone': 'Su ogni dispositivo, accessibile a tutti',
  'Version {version}': 'Versione {version}',
  'Open source, MPL-2.0': 'Open source, MPL-2.0',
  'Create an account': 'Crea un account',
  'Join {product} with your email address.': 'Entra in {product} con il tuo indirizzo email.',
  'Check your email': 'Controlla la tua email',
  'Sign in': 'Accedi',
  'Welcome back to {product}.': 'Bentornato in {product}.',
  'New here?': 'Sei nuovo?',
  'In {organization}.': 'In {organization}.',
  Organization: 'Organizzazione',
  'Your name': 'Il tuo nome',
  Email: 'Email',
  Password: 'Password',
  'Hide the password': 'Nascondi la password',
  'Show the password': 'Mostra la password',
  Hide: 'Nascondi',
  Show: 'Mostra',
  'At least 12 characters.': 'Almeno 12 caratteri.',
  'Create account': 'Crea account',
  'Back to sign in': "Torna all'accesso",
  'We sent a link to {address}. Open it to confirm your address, then sign in.':
    'Abbiamo inviato un link a {address}. Aprilo per confermare il tuo indirizzo, poi accedi.',
  'Send the link again': 'Invia di nuovo il link',
  'Email or username': 'Email o nome utente',
  Continue: 'Continua',
  or: 'oppure',
  'Sign in with a password': 'Accedi con una password',
  'Remember me': 'Ricordami',
  'Stay signed in on this device for {days} days.':
    'Resta collegato su questo dispositivo per {days} giorni.',
  Back: 'Indietro',
  'Your email address is confirmed. Sign in to start.':
    'Il tuo indirizzo email è confermato. Accedi per iniziare.',
  'We sent a new link. The previous ones do not work any more.':
    'Abbiamo inviato un nuovo link. I precedenti non funzionano più.',
  // The shell
  Home: 'Home',
  Extensions: 'Estensioni',
  Platform: 'Piattaforma',
  Settings: 'Impostazioni',
  Apps: 'App',
  'Search apps and pages': 'Cerca app e pagine',
  'Apps and pages': 'App e pagine',
  'Account: {name}': 'Account: {name}',
  Account: 'Account',
  'Sign out': 'Esci',
  'Welcome, {name}': 'Benvenuto, {name}',
  '{count} apps available.': '{count} app disponibili.',
  '{count} extensions could not be loaded.': '{count} estensioni non sono state caricate.',
  'Your apps': 'Le tue app',
  Widgets: 'Widget',
  'From {product}': 'Da {product}',
  'You are signed in, but the apps could not be loaded: {reason} Reload the page; if it happens again, tell your administrator.':
    "Hai effettuato l'accesso, ma le app non sono state caricate: {reason} Ricarica la pagina; se succede di nuovo, avvisa l'amministratore.",
  // Personal settings
  'Your settings': 'Le tue impostazioni',
  Appearance: 'Aspetto',
  'As the device': 'Come il dispositivo',
  Light: 'Chiaro',
  Dark: 'Scuro',
  'High contrast': 'Alto contrasto',
  Theme: 'Tema',
  'Default of the installation': "Predefinito dell'installazione",
  Language: 'Lingua',
  'Apps in the app bar': 'App nella barra delle app',
  'Pinned by your organization': 'Fissata dalla tua organizzazione',
  'Saved.': 'Salvato.',
  // Sessions (MK-125)
  Sessions: 'Sessioni',
  'Where you are signed in. End a session you do not recognize: it is signed out at once.':
    "Dove hai effettuato l'accesso. Termina una sessione che non riconosci: viene chiusa subito.",
  'No active session.': 'Nessuna sessione attiva.',
  'This browser': 'Questo browser',
  'Signed in {created} · last used {seen}': 'Accesso {created} · ultimo uso {seen}',
  'through your organization': 'tramite la tua organizzazione',
  'End session': 'Termina sessione',
  'Session ended: {device}': 'Sessione terminata: {device}',
  'The session was not ended: {reason}': 'La sessione non è stata terminata: {reason}',
  'The sessions cannot be read: {reason}': 'Le sessioni non possono essere lette: {reason}',
  '{browser} on {system}': '{browser} su {system}',
  'Unknown device': 'Dispositivo sconosciuto',
  'Not saved: {reason}': 'Non salvato: {reason}',
  // Access keys (MK-060)
  'Access keys': 'Chiavi di accesso',
  'Keys let your scripts and other programs call the platform as you, in one organization. Treat a key like a password; revoke it when you no longer need it.':
    'Le chiavi permettono ai tuoi script e ad altri programmi di usare la piattaforma come te, in una organizzazione. Tratta una chiave come una password; revocala quando non ti serve più.',
  'No access key.': 'Nessuna chiave di accesso.',
  'New access key': 'Nuova chiave di accesso',
  'Expires after': 'Scade dopo',
  '{days} days': '{days} giorni',
  'Allow changes (write)': 'Consenti modifiche (scrittura)',
  'Create key': 'Crea chiave',
  'Your new key {name}': 'La tua nuova chiave {name}',
  'Copy it now and keep it somewhere safe: it will not be shown again.':
    'Copiala ora e conservala in un posto sicuro: non verrà più mostrata.',
  'The new access key': 'La nuova chiave di accesso',
  Copy: 'Copia',
  Done: 'Fatto',
  Expired: 'Scaduta',
  Revoke: 'Revoca',
  'Reads and writes': 'Legge e scrive',
  'Read only': 'Solo lettura',
  never: 'mai',
  'expired {date}': 'scaduta il {date}',
  'expires {date}': 'scade il {date}',
  '{prefix}… · created {created} · last used {used} · {expiry}':
    '{prefix}… · creata {created} · ultimo uso {used} · {expiry}',
  'The access keys cannot be read: {reason}':
    'Le chiavi di accesso non possono essere lette: {reason}',
  'Name the key, so that you recognize it later.':
    'Dai un nome alla chiave, per riconoscerla in seguito.',
  'Key created: {name}. Copy it now, it will not be shown again.':
    'Chiave creata: {name}. Copiala ora, non verrà più mostrata.',
  'The key was not created: {reason}': 'La chiave non è stata creata: {reason}',
  'no clipboard': 'appunti non disponibili',
  'Key copied.': 'Chiave copiata.',
  'The key was not copied: {reason}. Select it and copy it.':
    'La chiave non è stata copiata: {reason}. Selezionala e copiala.',
  'The key was not revoked: {reason}': 'La chiave non è stata revocata: {reason}',
  'Key revoked: {name}': 'Chiave revocata: {name}',
  // Activity (MK-038)
  Activity: 'Attività',
  'Activity, {count} unread': 'Attività, {count} non lette',
  'Mark all as read': 'Segna tutte come lette',
  'Nothing new.': 'Niente di nuovo.',
  Notifications: 'Notifiche',
  'Unread: {title}': 'Non letta: {title}',
  // Favorites (MK-094)
  Favorites: 'Preferiti',
  'No favorites yet. Mark a resource as favorite in its app to find it here.':
    'Ancora nessun preferito. Segna una risorsa come preferita nella sua app per trovarla qui.',
  'Remove {title} from favorites': 'Rimuovi {title} dai preferiti',
  'The favorites cannot be read: {reason}': 'I preferiti non possono essere letti: {reason}',
  // Offline (MK-029)
  'You are offline: what you see may not be up to date, and changes wait for the network.':
    'Sei offline: ciò che vedi potrebbe non essere aggiornato, e le modifiche aspettano la rete.',
  // Apps of the organization
  'Organization apps': "App dell'organizzazione",
  'The apps of the app bar of your organization, in their order.':
    'Le app della barra della tua organizzazione, nel loro ordine.',
  App: 'App',
  Shown: 'Visibile',
  Pinned: 'Fissata',
  For: 'Per',
  Order: 'Ordine',
  'Show {app}': 'Mostra {app}',
  'Pin {app}': 'Fissa {app}',
  'Who sees {app}': 'Chi vede {app}',
  Everyone: 'Tutti',
  Administrators: 'Amministratori',
  'Move {app} up': 'Sposta {app} in alto',
  'Move {app} down': 'Sposta {app} in basso',
  Save: 'Salva',
  'Who holds its permission': 'Chi ha il suo permesso',
  'Members and administrators': 'Membri e amministratori',
  'An app for who holds its permission shows to the administrators and to the people it is granted to in Permissions, through a profile, a team or a personal exception.':
    "Un'app per chi ha il suo permesso è visibile agli amministratori e alle persone a cui è concesso in Permessi, con un profilo, un team o un'eccezione personale.",
  // Permissions of the organization (MK-056)
  Permissions: 'Permessi',
  'What the people of your organization may do in each extension. A permission is off until a profile, a team or a personal exception grants it; administrators hold every permission.':
    "Cosa possono fare le persone della tua organizzazione in ogni estensione. Un permesso è spento finché un profilo, un team o un'eccezione personale non lo concede; gli amministratori hanno tutti i permessi.",
  Profiles: 'Profili',
  People: 'Persone',
  Teams: 'Team',
  Team: 'Team',
  'Team {name}': 'Team {name}',
  Profile: 'Profilo',
  'Profile {name}': 'Profilo {name}',
  'New profile': 'Nuovo profilo',
  default: 'predefinito',
  'No profiles yet: members hold no permission.':
    'Ancora nessun profilo: i membri non hanno permessi.',
  Name: 'Nome',
  Description: 'Descrizione',
  'Default profile of members: for those without a profile of their own':
    'Profilo predefinito dei membri: per chi non ha un profilo proprio',
  'Default profile of members ({name})': 'Profilo predefinito dei membri ({name})',
  'Default profile of members (none)': 'Profilo predefinito dei membri (nessuno)',
  Delete: 'Elimina',
  'Deleted.': 'Eliminato.',
  'Delete the profile {name}? Its members go back to the default profile.':
    'Eliminare il profilo {name}? I suoi membri tornano al profilo predefinito.',
  'No active extension declares permissions.': 'Nessuna estensione attiva dichiara permessi.',
  'All the apps of this extension are off: nobody holds its permissions.':
    'Tutte le app di questa estensione sono spente: nessuno ha i suoi permessi.',
  Person: 'Persona',
  Choose: 'Scegli',
  'Administrator of the organization': "Amministratore dell'organizzazione",
  'Administrator of the organization: holds every permission.':
    "Amministratore dell'organizzazione: ha tutti i permessi.",
  'Guest: no profile; only what their teams and personal exceptions grant.':
    'Ospite: nessun profilo; solo ciò che concedono i suoi team e le sue eccezioni personali.',
  'Member: their profile, their teams and their personal exceptions.':
    'Membro: il suo profilo, i suoi team e le sue eccezioni personali.',
  'Personal exception': 'Eccezione personale',
  'Personal exceptions': 'Eccezioni personali',
  'Permissions given to this person only, on top of the others.':
    'Permessi dati solo a questa persona, in aggiunta agli altri.',
  'What they can do': 'Cosa può fare',
  'Granted.': 'Concesso.',
  'Revoked.': 'Revocato.',
  'Granted to every member and guest of the team.': 'Concessi a ogni membro e ospite del team.',
  'The organization has no teams.': "L'organizzazione non ha team.",
  'Not loaded: {reason}': 'Non caricato: {reason}',
  'No permissions.': 'Nessun permesso.',
  'From: {sources}': 'Da: {sources}',
  'Not held: all the apps of its extension are off.':
    'Non attivo: tutte le app della sua estensione sono spente.',
  // Invitations (MK-056)
  'Invite a person': 'Invita una persona',
  'For a person who has no account yet.': 'Per una persona che non ha ancora un account.',
  Role: 'Ruolo',
  Member: 'Membro',
  Administrator: 'Amministratore',
  Guest: 'Ospite',
  Apply: 'Applica',
  'This person is not a member yet: a platform administrator adds them, until invitations by link arrive. The preview shows what they would hold.':
    "Questa persona non è ancora membro: la aggiunge un amministratore della piattaforma, finché non arrivano gli inviti tramite link. L'anteprima mostra cosa avrebbe.",
  'Administrators hold every permission.': 'Gli amministratori hanno tutti i permessi.',
  'What they will be able to do': 'Cosa potrà fare',
  Cancel: 'Annulla',
  Invite: 'Invita',
  'The preview failed: {reason}': "L'anteprima non è riuscita: {reason}",
  'Write the email address of the person.': "Scrivi l'indirizzo email della persona.",
  'Not invited: {reason}': 'Non invitata: {reason}',
  '{email} is in the organization.': "{email} è nell'organizzazione.",
  // Accounts created by administrators (MK-048)
  'Choose your password': 'Scegli la tua password',
  'An administrator created your account. Choose a password, then sign in with your email address and this password.':
    'Un amministratore ha creato il tuo account. Scegli una password, poi accedi con il tuo indirizzo email e questa password.',
  'New password': 'Nuova password',
  'Set the password': 'Imposta la password',
  'Your password is set. Sign in with your email address and the new password.':
    'La tua password è impostata. Accedi con il tuo indirizzo email e la nuova password.',
  'For a person who has no account yet. They choose their password with a link that works once: mailed to them, or shown here for you to pass on when this installation sends no mail.':
    'Per una persona che non ha ancora un account. Sceglie la password con un link che funziona una volta sola: le arriva per email, oppure, se questa installazione non invia email, lo vedi qui per consegnarglielo.',
  'Name of the person': 'Nome della persona',
  'Email address': 'Indirizzo email',
  'Role in the organization': "Ruolo nell'organizzazione",
  'Link to set the password': 'Link per impostare la password',
  'Link for {name}': 'Link per {name}',
  'Copy the link': 'Copia il link',
  'Copied.': 'Copiato.',
  'Select the link and copy it.': 'Seleziona il link e copialo.',
  'Not created: {reason}': 'Non creato: {reason}',
  'We mailed {email} a link to choose the password. It works once, until {until}.':
    'Abbiamo inviato a {email} un link per scegliere la password. Funziona una volta sola, fino al {until}.',
  'This installation sends no mail: give this link to {email}. It is shown only now, and works once, until {until}.':
    'Questa installazione non invia email: consegna questo link a {email}. È mostrato solo ora e funziona una volta sola, fino al {until}.',
  'Has not chosen a password yet.': 'Non ha ancora scelto una password.',
  'New link to set the password': 'Nuovo link per impostare la password',
  'No new link: {reason}': 'Nessun nuovo link: {reason}',
  // Credentials of extensions (MK-062)
  Credentials: 'Credenziali',
  'Keys and passwords with which the extensions of your organization call other services. They are encrypted, only the servers of the extensions read them, and nobody sees a value again after saving it.':
    'Chiavi e password con cui le estensioni della tua organizzazione chiamano altri servizi. Sono cifrate, le leggono solo i server delle estensioni, e nessuno rivede un valore dopo averlo salvato.',
  'No credential yet.': 'Ancora nessuna credenziale.',
  Kind: 'Tipo',
  Value: 'Valore',
  Changed: 'Modificata',
  Actions: 'Azioni',
  Token: 'Token',
  Key: 'Chiave',
  Other: 'Altro',
  'Any extension': 'Qualsiasi estensione',
  '{when} by {person}': '{when} da {person}',
  'Replace {name}': 'Sostituisci {name}',
  'Delete {name}': 'Elimina {name}',
  Replace: 'Sostituisci',
  'Store a credential': 'Salva una credenziale',
  'How the extensions ask for it, such as model-provider.':
    'Il nome con cui la chiedono le estensioni, come model-provider.',
  'New value': 'Nuovo valore',
  'Leave it empty to keep the current value.': 'Lascialo vuoto per mantenere il valore attuale.',
  'It is encrypted at once and never shown again.':
    'Viene cifrato subito e non viene più mostrato.',
  'Only for the extension': "Solo per l'estensione",
  'Its identifier, such as org.example.reports. Empty: any extension may use it.':
    'Il suo identificativo, come org.example.reports. Vuoto: può usarla qualsiasi estensione.',
  'Save changes': 'Salva le modifiche',
  'Store credential': 'Salva la credenziale',
  'Delete the credential {name}? The extensions that use it stop working with it.':
    'Eliminare la credenziale {name}? Le estensioni che la usano smettono di funzionare con essa.',
  'The name has lowercase letters, digits, dots, dashes and underscores, such as model-provider.':
    'Il nome ha lettere minuscole, cifre, punti, trattini e trattini bassi, come model-provider.',
  'Write the value.': 'Scrivi il valore.',
  'The value is too long.': 'Il valore è troppo lungo.',
  'The description is too long.': 'La descrizione è troppo lunga.',
  'The extension is its identifier, such as org.example.reports.':
    "L'estensione si indica con il suo identificativo, come org.example.reports.",
  'The credentials cannot be read: {reason}': 'Non è possibile leggere le credenziali: {reason}',
  'Credential {name} replaced.': 'Credenziale {name} sostituita.',
  'Credential {name} stored.': 'Credenziale {name} salvata.',
  'The credential was not deleted: {reason}': 'La credenziale non è stata eliminata: {reason}',
  'Credential {name} deleted.': 'Credenziale {name} eliminata.',
  // Credentials of the installation (MK-127)
  'Installation credentials': "Credenziali dell'installazione",
  'Keys and passwords of services shared by every organization, such as a mail relay or the account of a shared server. The extensions of every organization read them on their servers, unless the organization keeps a credential with the same name. They are encrypted, and nobody sees a value again after saving it.':
    "Chiavi e password di servizi condivisi da tutte le organizzazioni, come un relay di posta o l'account di un server condiviso. Le leggono sui loro server le estensioni di ogni organizzazione, a meno che l'organizzazione non abbia una credenziale con lo stesso nome. Sono cifrate, e nessuno rivede un valore dopo averlo salvato.",
  // Quotas of the organization (MK-076)
  Quotas: 'Quote',
  'What your organization keeps and uses of each measure, against its limit. The figures are current: they change with every action.':
    'Quanto la tua organizzazione conserva e usa di ogni misura, rispetto al suo limite. I valori sono aggiornati: cambiano a ogni azione.',
  Limits: 'Limiti',
  Measure: 'Misura',
  Used: 'Usato',
  Limit: 'Limite',
  'Share of the limit': 'Quota del limite',
  'Built in': 'Integrata',
  '{measure}: {share}% of the limit': '{measure}: {share}% del limite',
  'New limit': 'Nuovo limite',
  'Set the limit of {measure}': 'Imposta il limite di {measure}',
  Set: 'Imposta',
  'Use the default of the platform for {measure}':
    'Usa il valore predefinito della piattaforma per {measure}',
  'Use the default': 'Usa il predefinito',
  'Consumption by person': 'Consumo per persona',
  Month: 'Mese',
  'Storage is shown as it is now.': "Lo spazio è mostrato com'è adesso.",
  'Nothing used in this month.': 'Niente di usato in questo mese.',
  Period: 'Periodo',
  '{count} bytes': '{count} byte',
  'No limit': 'Nessun limite',
  '{amount} a month': '{amount} al mese',
  'Set for this organization': 'Impostato per questa organizzazione',
  'Default of the platform': 'Predefinito della piattaforma',
  'Nobody in particular': 'Nessuno in particolare',
  'A person who left': "Una persona che non c'è più",
  Now: 'Adesso',
  'The quotas cannot be read: {reason}': 'Non è possibile leggere le quote: {reason}',
  'Write a number of bytes, or a size such as 500M or 10G; empty for no limit.':
    'Scrivi un numero di byte, o una dimensione come 500M o 10G; vuoto per nessun limite.',
  'Write a whole number; empty for no limit.': 'Scrivi un numero intero; vuoto per nessun limite.',
  'Limit of {measure} set: {limit}.': 'Limite di {measure} impostato: {limit}.',
  'Limit of {measure}: {limit}, the default of the platform.':
    'Limite di {measure}: {limit}, il predefinito della piattaforma.',
  // Platform settings
  'Platform settings': 'Impostazioni della piattaforma',
  'People can create their own account': 'Le persone possono creare il proprio account',
  'On the sign-in page, in the organizations that allow it. A link sent by mail confirms the address before the first sign-in.':
    "Nella pagina di accesso, nelle organizzazioni che lo consentono. Un link inviato per email conferma l'indirizzo prima del primo accesso.",
  'People can create their own account.': 'Le persone possono creare il proprio account.',
  'Self-registration is off.': 'La registrazione autonoma è disattivata.',
  // External origins of the content security policy (MK-128)
  'External origins': 'Origini esterne',
  'Services outside the installation that the shell and the extensions may contact from the browser, for images, data and tiles. Every other address stays blocked by the content security policy of the browser.':
    "Servizi fuori dall'installazione che la shell e le estensioni possono contattare dal browser, per immagini, dati e tile. Ogni altro indirizzo resta bloccato dalla politica di sicurezza dei contenuti del browser.",
  'No external origin: the browser contacts this installation only.':
    'Nessuna origine esterna: il browser contatta solo questa installazione.',
  Origin: 'Origine',
  'Allowed since': 'Consentita dal',
  'Set in the configuration of the installation':
    "Impostata nella configurazione dell'installazione",
  'Allow an origin': "Consenti un'origine",
  'Scheme, host and port only, such as https://tiles.example.org or https://*.tiles.example.org.':
    'Solo schema, host e porta, come https://tiles.example.org o https://*.tiles.example.org.',
  Allow: 'Consenti',
  'Remove {origin}': 'Rimuovi {origin}',
  'Remove {origin}? Images, data and tiles of that service stop loading in the browser.':
    'Rimuovere {origin}? Immagini, dati e tile di quel servizio smettono di caricarsi nel browser.',
  'Write an origin such as https://tiles.example.org: a scheme (https, wss, http or ws), a host and a port, without a path.':
    "Scrivi un'origine come https://tiles.example.org: uno schema (https, wss, http o ws), un host e una porta, senza percorso.",
  '{origin} allowed.': '{origin} consentita.',
  '{origin} removed.': '{origin} rimossa.',
  'The origins cannot be read: {reason}': 'Non è possibile leggere le origini: {reason}',
  'Not allowed: {reason}': 'Non consentita: {reason}',
  'Not removed: {reason}': 'Non rimossa: {reason}',
  'The kernel sends the policy in production only: in this installation the browser is not restricted.':
    'Il kernel invia la politica solo in produzione: in questa installazione il browser non è limitato.',
  // Service identities (MK-124)
  'Service identities': 'Identità di servizio',
  'For the services that call the APIs of extensions without a person, such as a gateway. Each has its own key, the APIs it may call and no organization; it never opens the shell.':
    'Per i servizi che chiamano le API delle estensioni senza una persona, come un gateway. Ognuna ha la sua chiave, le API che può chiamare e nessuna organizzazione; non apre mai la shell.',
  'No service identity.': 'Nessuna identità di servizio.',
  'New service identity': 'Nuova identità di servizio',
  'Create service identity': 'Crea identità di servizio',
  'APIs of extensions': 'API delle estensioni',
  'The names in /api/v1/ext/<api>/, separated by commas, such as catalog.':
    'I nomi in /api/v1/ext/<api>/, separati da virgole, come catalog.',
  'Endpoints of the kernel': 'Endpoint del kernel',
  'Check the sessions of people': 'Verifica le sessioni delle persone',
  'Check the access keys of people': 'Verifica le chiavi di accesso delle persone',
  'Organizations it may name': 'Organizzazioni che può indicare',
  'Slugs, separated by commas; with the X-Mosaikit-Organization header, a call acts on one of them. Leave empty for none.':
    "Slug, separati da virgole; con l'intestazione X-Mosaikit-Organization, una chiamata agisce su una di esse. Lascia vuoto per nessuna.",
  'The new key of {name}': 'La nuova chiave di {name}',
  'Copy it now and put it in the configuration of the service: it will not be shown again.':
    'Copiala ora e mettila nella configurazione del servizio: non verrà più mostrata.',
  'The new key of the service': 'La nuova chiave del servizio',
  'No live key: create one to use this identity.':
    'Nessuna chiave attiva: creane una per usare questa identità.',
  'Keys of {name}': 'Chiavi di {name}',
  'New key': 'Nuova chiave',
  'Change what it may call': 'Cambia cosa può chiamare',
  'Change {name}': 'Modifica {name}',
  '{prefix}… · created {created} · last used {used}':
    '{prefix}… · creata {created} · ultimo uso {used}',
  'APIs: {apis}': 'API: {apis}',
  'No API of extensions': 'Nessuna API delle estensioni',
  'Kernel: {endpoints}': 'Kernel: {endpoints}',
  'Organizations: {organizations}': 'Organizzazioni: {organizations}',
  'The service identities cannot be read: {reason}':
    'Le identità di servizio non possono essere lette: {reason}',
  'Name the service identity after the service that uses it.':
    "Dai all'identità di servizio il nome del servizio che la usa.",
  'Service identity created: {name}. Copy its key now, it will not be shown again.':
    'Identità di servizio creata: {name}. Copia ora la sua chiave, non verrà più mostrata.',
  'The service identity was not created: {reason}':
    "L'identità di servizio non è stata creata: {reason}",
  'Saved: {name}': 'Salvato: {name}',
  'New key for {name}. Copy it now, put it in the service, then revoke the old key.':
    'Nuova chiave per {name}. Copiala ora, mettila nel servizio, poi revoca la vecchia chiave.',
  // Sharing (MK-055)
  'A person': 'Una persona',
  'Everyone in {name}': 'Tutti in {name}',
  'the organization': "l'organizzazione",
  'Everyone, also without an account': 'Chiunque, anche senza un account',
  'Link with a password, until {date}': 'Link con password, fino al {date}',
  'Link, until {date}': 'Link, fino al {date}',
  '{owner}, who owns it, the people with the level {level} and the administrators of the organization can share it.':
    "Possono condividerla {owner}, che ne è proprietario, le persone con il livello {level} e gli amministratori dell'organizzazione.",
  'The people with the level {level} and the administrators of the organization can share it.':
    "Possono condividerla le persone con il livello {level} e gli amministratori dell'organizzazione.",
  'You have no access to this resource.': 'Non hai accesso a questa risorsa.',
  'The sharing cannot be read: {reason}': 'La condivisione non si può leggere: {reason}',
  'Shared with {subject}.': 'Condiviso con {subject}.',
  'Not shared: {reason}': 'Non condiviso: {reason}',
  'Choose a day from tomorrow on.': 'Scegli un giorno da domani in poi.',
  'Link made. Copy it now: it is shown only once.':
    'Link creato. Copialo ora: si vede una volta sola.',
  'The link was not made: {reason}': 'Il link non è stato creato: {reason}',
  'Access removed: {subject}.': 'Accesso tolto: {subject}.',
  'The access was not removed: {reason}': "L'accesso non è stato tolto: {reason}",
  'Share {title}': 'Condividi {title}',
  Share: 'Condividi',
  'Your level: {level}': 'Il tuo livello: {level}',
  Close: 'Chiudi',
  'Who has access': 'Chi ha accesso',
  'Only who owns it and the administrators.': 'Solo chi ne è proprietario e gli amministratori.',
  'Access from {title}': 'Accesso da {title}',
  Owner: 'Proprietario',
  'Level of {subject}': 'Livello di {subject}',
  'Remove access of {subject}': "Togli l'accesso a {subject}",
  Remove: 'Togli',
  'A team': 'Un team',
  'Everyone in the organization': "Tutti nell'organizzazione",
  'Share with': 'Condividi con',
  Who: 'Chi',
  Level: 'Livello',
  Link: 'Link',
  'Anyone with the link opens it, also without an account, until it expires or is removed.':
    'Chiunque abbia il link lo apre, anche senza account, finché non scade o viene tolto.',
  'Link level': 'Livello del link',
  'Expires on': 'Scade il',
  'Password (optional)': 'Password (facoltativa)',
  'Create link': 'Crea link',
  'Address of the link': 'Indirizzo del link',
  'Shown only now: copy it and give it to the people you choose.':
    'Si vede solo ora: copialo e dallo alle persone che scegli.',
  Copied: 'Copiato',
  'Copy the address': "Copia l'indirizzo",
  'Select the address and copy it.': "Seleziona l'indirizzo e copialo.",
  'Opening the link…': 'Apertura del link…',
  'Link not found': 'Link non trovato',
  'This link does not exist: it may have expired or been removed. Ask who gave it to you for a new one.':
    'Questo link non esiste: può essere scaduto o essere stato tolto. Chiedine uno nuovo a chi te lo ha dato.',
  'The link cannot be opened: {reason}': 'Il link non si può aprire: {reason}',
  'This link asks for a password': 'Questo link chiede una password',
  'The password is not correct.': 'La password non è corretta.',
  'Password of the link': 'Password del link',
  Open: 'Apri',
  'Shared with you through a link, until {date}.': 'Condiviso con te con un link, fino al {date}.',
  'Its app cannot show it here. Sign in to open it.':
    'La sua app non lo può mostrare qui. Accedi per aprirlo.',
  // The suspension of accounts by platform administrators (MK-125)
  Accounts: 'Account',
  'Suspend the account of a person who must not sign in any more, for example when they leave or lose a device: their sessions end at once, on every browser, and they sign in by no means until reinstated.':
    "Sospendi l'account di una persona che non deve più accedere, per esempio quando se ne va o perde un dispositivo: le sue sessioni terminano subito, su ogni browser, e non può accedere in alcun modo finché non viene riattivata.",
  'Find an account': 'Trova un account',
  'Email address of the account': "Indirizzo email dell'account",
  Find: 'Trova',
  'Suspended accounts': 'Account sospesi',
  'No account is suspended.': 'Nessun account è sospeso.',
  Reinstate: 'Riattiva',
  'Reason for the suspension': 'Motivo della sospensione',
  'Shown to the other platform administrators and kept in the audit log.':
    'Visibile agli altri amministratori della piattaforma e conservato nel registro di audit.',
  Suspend: 'Sospendi',
  Suspension: 'Sospensione',
  'Reinstate {name}': 'Riattiva {name}',
  // Organizations, and their deletion (MK-130)
  Organizations: 'Organizzazioni',
  'The organizations of the installation. Deleting one ends the access of its people at once; its data stay for the retention of the installation, then are removed.':
    "Le organizzazioni dell'installazione. Eliminarne una toglie subito l'accesso alle sue persone; i suoi dati restano per il periodo di conservazione dell'installazione, poi vengono rimossi.",
  'No organization yet.': 'Ancora nessuna organizzazione.',
  Slug: 'Slug',
  Created: 'Creata',
  'Its people lose access at once and it appears nowhere any more; its extensions are told. Its data stay for the retention of the installation, then are removed for good.':
    "Le sue persone perdono subito l'accesso e non compare più da nessuna parte; le sue estensioni vengono avvisate. I suoi dati restano per il periodo di conservazione dell'installazione, poi vengono rimossi definitivamente.",
  'Write {slug} to confirm': 'Scrivi {slug} per confermare',
  'Delete the organization': "Elimina l'organizzazione",
  'The organizations cannot be read: {reason}':
    'Le organizzazioni non si possono leggere: {reason}',
  'Write {slug} to confirm: nothing was deleted.':
    'Scrivi {slug} per confermare: non è stato eliminato nulla.',
  '{name} deleted: {members} people lost access. Its data are removed from {date}.':
    "{name} eliminata: {members} persone hanno perso l'accesso. I suoi dati vengono rimossi dal {date}.",
  'Not deleted: {reason}': 'Non eliminata: {reason}',
  'Suspend {name}? Their sessions end at once and they cannot sign in until reinstated.':
    'Sospendere {name}? Le sue sessioni terminano subito e non può accedere finché non viene riattivato.',
  'Active: the person signs in.': 'Attivo: la persona può accedere.',
  'Suspended {when} by {person}.': 'Sospeso il {when} da {person}.',
  'Reason: {reason}': 'Motivo: {reason}',
  'No reason was given.': 'Nessun motivo indicato.',
  'The suspended accounts cannot be read: {reason}':
    'Gli account sospesi non si possono leggere: {reason}',
  'Write the email address of the account.': "Scrivi l'indirizzo email dell'account.",
  'No account has the email address {address}.': "Nessun account ha l'indirizzo email {address}.",
  'The account cannot be read: {reason}': "L'account non si può leggere: {reason}",
  'Write the reason for the suspension.': 'Scrivi il motivo della sospensione.',
  'The reason is longer than {max} characters.': 'Il motivo supera i {max} caratteri.',
  '{name} is suspended: their sessions ended.': '{name} è sospeso: le sue sessioni sono terminate.',
  'The account cannot be suspended: {reason}': "L'account non si può sospendere: {reason}",
  '{name} is reinstated and can sign in again.': '{name} è riattivato e può accedere di nuovo.',
  'The account cannot be reinstated: {reason}': "L'account non si può riattivare: {reason}",
  // The trash (MK-095)
  Trash: 'Cestino',
  'What you delete in the apps stays here for a while, with what was inside it: restore it, with its shares, or delete it for good. After the retention of the installation it is deleted for good.':
    "Quello che elimini nelle app resta qui per un po', con quello che conteneva: ripristinalo, con le sue condivisioni, o eliminalo definitivamente. Dopo il periodo di conservazione dell'installazione viene eliminato definitivamente.",
  'Show the trash of the whole organization': "Mostra il cestino di tutta l'organizzazione",
  'The trash is empty.': 'Il cestino è vuoto.',
  'The trash cannot be read: {reason}': 'Il cestino non si può leggere: {reason}',
  Deleted: 'Eliminato',
  'The organization': "L'organizzazione",
  Restore: 'Ripristina',
  'Restore {title}': 'Ripristina {title}',
  'Delete for good': 'Elimina definitivamente',
  'Delete {title} for good': 'Elimina definitivamente {title}',
  'Delete {title} for good? It cannot be restored any more.':
    'Eliminare definitivamente {title}? Non si potrà più ripristinare.',
  '{title} restored.': '{title} ripristinato.',
  'Not restored: {reason}': 'Non ripristinato: {reason}',
  '{title} deleted for good.': '{title} eliminato definitivamente.',
  'Not deleted for good: {reason}': 'Non eliminato definitivamente: {reason}',
  'Deleted for good on {date}': 'Eliminato definitivamente il {date}',
  '{kind}, with 1 item inside': '{kind}, con 1 elemento dentro',
  '{kind}, with {count} items inside': '{kind}, con {count} elementi dentro',
  // Offboarding a member (MK-071)
  'Remove from the organization': "Rimuovi dall'organizzazione",
  'First you see what they own, and choose who takes it over.':
    'Prima vedi quello che possiede e scegli chi lo prende in carico.',
  'Remove {email}…': 'Rimuovi {email}…',
  '{email} owns nothing in the apps.': '{email} non possiede nulla nelle app.',
  '{email} owns {count} resources:': '{email} possiede {count} risorse:',
  'in the trash': 'nel cestino',
  'New owner, with their shares': 'Nuovo proprietario, con le condivisioni',
  'What {email} owns cannot be read: {reason}':
    'Quello che possiede {email} non si può leggere: {reason}',
  'Choose who takes over what they own.': 'Scegli chi prende in carico quello che possiede.',
  '{email} was removed; {heir} owns their {count} resources.':
    '{email} è stato rimosso; {heir} possiede le sue {count} risorse.',
  '{email} was removed.': '{email} è stato rimosso.',
  // Requests for access (MK-058)
  'Requests for access': 'Richieste di accesso',
  'Request access': 'Chiedi accesso',
  'The owner or an administrator of the organization reads your request and decides. You are notified of the answer.':
    "Il proprietario o un amministratore dell'organizzazione legge la tua richiesta e decide. Ricevi una notifica con la risposta.",
  'Message (optional)': 'Messaggio (facoltativo)',
  'Send the request': 'Invia la richiesta',
  'Request sent. You will be notified when it is answered.':
    'Richiesta inviata. Riceverai una notifica quando avrà risposta.',
  'The request was not sent: {reason}': 'La richiesta non è stata inviata: {reason}',
  'The message is too long: at most {count} characters.':
    'Il messaggio è troppo lungo: al massimo {count} caratteri.',
  'No requests to decide': 'Nessuna richiesta da decidere',
  'When someone asks for access to a resource you may share, the request shows here.':
    'Quando qualcuno chiede accesso a una risorsa che puoi condividere, la richiesta compare qui.',
  'The requests for access cannot be read: {reason}':
    'Le richieste di accesso non si possono leggere: {reason}',
  '{name} asks for {level} on {title}': '{name} chiede {level} su {title}',
  'Level to grant to {name}': 'Livello da concedere a {name}',
  Approve: 'Approva',
  'Approve the request of {name}': 'Approva la richiesta di {name}',
  'Reason (optional)': 'Motivo (facoltativo)',
  'Reason for declining the request of {name}': 'Motivo del rifiuto della richiesta di {name}',
  Decline: 'Rifiuta',
  'Decline the request of {name}': 'Rifiuta la richiesta di {name}',
  '{name} may now open {title} ({level}).': '{name} ora può aprire {title} ({level}).',
  'Not approved: {reason}': 'Non approvata: {reason}',
  'The request of {name} was declined.': 'La richiesta di {name} è stata rifiutata.',
  'Not declined: {reason}': 'Non rifiutata: {reason}',
  Someone: 'Qualcuno',
};

const TRANSLATIONS: Record<Language, Record<string, string>> = { en: {}, it: ITALIAN };

let current: Language = 'en';

/** Whether a value is a language of the shell. */
export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

/** The language of the browser, when the shell has it; English otherwise. */
export function browserLanguage(): Language {
  const code = (typeof navigator === 'undefined' ? 'en' : navigator.language)
    .slice(0, 2)
    .toLowerCase();
  return isLanguage(code) ? code : 'en';
}

/** Uses a language for the next texts; the components render again when it changes. */
export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

export function language(): Language {
  return current;
}

/** The text in the current language, with `{name}` replaced by the value of `values.name`. */
export function t(text: string, values: Record<string, string | number> = {}): string {
  const translated = TRANSLATIONS[current][text] ?? text;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
