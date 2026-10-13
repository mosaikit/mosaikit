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
  // Activity (MK-038)
  Activity: 'Attività',
  'Activity, {count} unread': 'Attività, {count} non lette',
  'Mark all as read': 'Segna tutte come lette',
  'Nothing new.': 'Niente di nuovo.',
  Notifications: 'Notifiche',
  'Unread: {title}': 'Non letta: {title}',
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
  // Platform settings
  'Platform settings': 'Impostazioni della piattaforma',
  'People can create their own account': 'Le persone possono creare il proprio account',
  'On the sign-in page, in the organizations that allow it. A link sent by mail confirms the address before the first sign-in.':
    "Nella pagina di accesso, nelle organizzazioni che lo consentono. Un link inviato per email conferma l'indirizzo prima del primo accesso.",
  'People can create their own account.': 'Le persone possono creare il proprio account.',
  'Self-registration is off.': 'La registrazione autonoma è disattivata.',
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
