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
  Plugins: 'Plugin',
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
  '{count} plugins could not be loaded.': '{count} plugin non sono stati caricati.',
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
