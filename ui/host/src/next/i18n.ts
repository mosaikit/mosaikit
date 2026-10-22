// Lingua dell'interfaccia del prototipo: italiano e inglese, scelta da chi usa l'app e ricordata dal
// browser (al primo accesso quella del browser). Per ora sono tradotte le pagine di accesso, la cornice
// (sidebar, barra in alto, menu, notifiche) e Account; le altre pagine sono in italiano.
// I testi sono indicizzati dalla frase italiana: `t('Accedi')`; i segnaposto si scrivono {nome}.

import { useSyncExternalStore } from 'react'

export type Lang = 'it' | 'en'
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'it', name: 'Italiano' },
  { id: 'en', name: 'English' },
]

const EN: Record<string, string> = {
  Accedi: 'Sign in',
  'al tenant': 'to the tenant',
  'con le credenziali del tuo tenant': 'with the credentials of your tenant',
  Tenant: 'Tenant',
  'Scegli il tenant…': 'Choose your tenant…',
  'Scegli il tenant': 'Choose your tenant',
  Utente: 'Username',
  Password: 'Password',
  'Invitato in altri tenant? Entra dal tuo, poi cambia tenant dalla barra in alto.': 'Invited to other tenants? Sign in to your own, then switch from the top bar.',
  'Accesso amministratori': 'Administrator access',
  'Accesso utenti': 'Sign-in of the tenants',
  'Nessun tenant disponibile. Primo avvio: entra come amministratore e crea un tenant.': 'No tenant available. First start: sign in as an administrator and create one.',
  'Sviluppo: scegli un utente di prova dal campo Utente, la password si compila da sola.': 'Development: pick a test user in the Username field, the password fills in by itself.',
  'Secondo passaggio': 'Second step',
  'Registra l’app': 'Register the app',
  'Codici di recupero': 'Recovery codes',
  'Sempre con la password locale e il secondo fattore, qualunque cosa usino i tenant.': 'Always with the local password and the second factor, whatever the tenants use.',
  'Il codice dell’app di autenticazione, oppure un codice di recupero.': 'The code of your authenticator app, or a recovery code.',
  'Primo accesso: inquadra il codice con Google o Microsoft Authenticator, FreeOTP o simili.': 'First sign-in: scan the code with Google or Microsoft Authenticator, FreeOTP or similar.',
  "QR code da inquadrare con l'app": 'QR code to scan with the app',
  'Oppure la chiave a mano:': 'Or type the key by hand:',
  'Codice mostrato dall’app': 'Code shown by the app',
  Codice: 'Code',
  'Attiva e accedi': 'Turn on and sign in',
  Conferma: 'Confirm',
  Ricomincia: 'Start again',
  'Primo avvio: utente': 'First start: user',
  'La verifica in due passaggi è attiva. Conserva questi codici: ognuno vale una volta, se perdi il telefono. Non verranno più mostrati.':
    'Two-step verification is on. Keep these codes: each one works once, if you lose your phone. They will not be shown again.',
  'Copia i codici': 'Copy the codes',
  'Ho salvato i codici: continua': 'I saved the codes: continue',
  'Il tuo lavoro, in un posto solo': 'Your work, in one place',
  'La piattaforma, in un posto solo': 'The platform, in one place',
  'Le app del tuo tenant, per le persone che ci lavorano ogni giorno.': 'The apps of your tenant, for the people who work in it every day.',
  'Tenant, plugin e amministratori: tutta la piattaforma da qui.': 'Tenants, plugins and administrators: the whole platform from here.',
  'Le app del tenant, con i permessi di ciascuno': 'The apps of the tenant, with everyone’s permissions',
  'Condivisioni, link pubblici e attività in un posto solo': 'Shares, public links and activity in one place',
  'Accessibile secondo le WCAG 2.1 AA': 'Accessible according to WCAG 2.1 AA',
  'Tenant, utenti e gestori': 'Tenants, users and managers',
  'Plugin firmati, catalogo e KPI': 'Signed plugins, catalog and KPIs',
  'Secondo fattore per ogni accesso': 'Second factor at every sign-in',
  Lingua: 'Language',
  'Modo: {m}': 'Mode: {m}',
  Chiaro: 'Light',
  Scuro: 'Dark',
  Automatico: 'Automatic',
  Supporto: 'Support',
  Accessibilità: 'Accessibility',
  Privacy: 'Privacy',
  'Note legali': 'Legal notes',
  'prototipo della nuova shell': 'prototype of the new shell',
  Piattaforma: 'Platform',
  'Spazio di lavoro': 'Workspace',
  // cornice: sidebar, barra in alto, menu, notifiche
  Home: 'Home',
  Panoramica: 'Overview',
  'Panoramica del tenant': 'Tenant overview',
  'Panoramica della piattaforma': 'Platform overview',
  App: 'Apps',
  'Gestione del tenant': 'Tenant management',
  Gestisci: 'Manage',
  Condivisioni: 'Shares',
  Consumi: 'Usage',
  Impostazioni: 'Settings',
  'Impostazioni del tenant': 'Tenant settings',
  Sistema: 'System',
  Pagine: 'Pages',
  'Apri o chiudi la sidebar': 'Open or close the sidebar',
  'L’Administrator lavora sulla piattaforma, non dentro un tenant': 'The Administrator works on the platform, not inside a tenant',
  'Tenant: {name}. Cambia tenant': 'Tenant: {name}. Switch tenant',
  Appartenenza: 'Home tenant',
  'Ospite in': 'Guest in',
  'Accedi sempre con le credenziali di {home}: cambiare tenant non chiede di rientrare.': 'You always sign in with the credentials of {home}: switching tenant does not ask you to sign in again.',
  Tonalità: 'Mode',
  'Tonalità: chiaro, scuro o automatico': 'Mode: light, dark or automatic',
  'Tema e altre preferenze': 'Theme and other preferences',
  'Lingua: {name}': 'Language: {name}',
  Aiuto: 'Help',
  'Aiuto e versione': 'Help and version',
  'Tour guidato di questa pagina': 'Guided tour of this page',
  'Guida di Mosaikit': 'Guide of Mosaikit',
  'Novità della versione {v}': 'What is new in version {v}',
  'Scorciatoie da tastiera': 'Keyboard shortcuts',
  'Nel prodotto: {what}.': 'In the product: {what}.',
  'Menu di {name}': 'Menu of {name}',
  Account: 'Account',
  Notifiche: 'Notifications',
  '{n} nuove': '{n} new',
  Esci: 'Sign out',
  'Notifiche, {n} nuove': 'Notifications, {n} new',
  'Segna tutte come lette': 'Mark all as read',
  'Preferenze delle notifiche': 'Notification preferences',
  'Nessuna notifica': 'No notifications',
  'Nessuna notifica da leggere': 'Nothing to read',
  'Qui arrivano inviti, menzioni e avvisi delle app.': 'Invitations, mentions and alerts of the apps arrive here.',
  'Vedi tutte': 'See all',
  'non letta': 'unread',
  'Invito in {tenant}': 'Invitation to {tenant}',
  '{who} ti invita come {role}': '{who} invites you as {role}',
  'Un Tenant Manager': 'A Tenant Manager',
  Accetta: 'Accept',
  Rifiuta: 'Decline',
  'Invito accettato: trovi il tenant nel selettore in alto': 'Invitation accepted: the tenant is in the switcher at the top',
  'Invito rifiutato': 'Invitation declined',
  '{n} da leggere': '{n} to read',
  'Tutte lette': 'All read',
  'Cosa ricevo': 'What I receive',
  Tutte: 'All',
  'Non lette': 'Unread',
  'Torna alla panoramica': 'Back to the overview',
  // Account
  Profilo: 'Profile',
  'Accesso e sicurezza': 'Sign-in and security',
  'Aspetto e lingua': 'Appearance and language',
  'I miei tenant': 'My tenants',
  Dati: 'Details',
  'Li cambia un altro Administrator.': 'Another Administrator changes them.',
  'Li cambia il Tenant Manager del tuo tenant di appartenenza.': 'The Tenant Manager of your home tenant changes them.',
  Nome: 'Name',
  Ruolo: 'Role',
  'Tenant di appartenenza': 'Home tenant',
  'Administrator della piattaforma': 'Administrator of the platform',
  'Le due password non coincidono': 'The two passwords do not match',
  'Password aggiornata: le altre sessioni sono state chiuse': 'Password updated: the other sessions were closed',
  'Cambia password': 'Change password',
  'La password locale della piattaforma.': 'The local password of the platform.',
  'La password del tuo tenant di appartenenza: vale anche nei tenant in cui sei ospite.': 'The password of your home tenant: it also works in the tenants where you are a guest.',
  'Password attuale': 'Current password',
  'Nuova password': 'New password',
  'Almeno 10 caratteri, non tutti uguali.': 'At least 10 characters, not all the same.',
  'Ripeti la nuova password': 'Repeat the new password',
  'Aggiorna password': 'Update password',
  'Come accedi': 'How you sign in',
  'Password locale e secondo fattore (app di autenticazione)': 'Local password and second factor (authenticator app)',
  'Per registrare di nuovo l’app, chiedi a un altro Administrator di reimpostare il secondo fattore.': 'To register the app again, ask another Administrator to reset the second factor.',
  'Modo di autenticazione': 'Sign-in method',
  'Account locale del tenant': 'Local account of the tenant',
  'Se il tenant passa a un provider di identità (OIDC), accedi da lì.': 'If the tenant moves to an identity provider (OIDC), you sign in there.',
  'Le notifiche arrivano nella campanella in alto. L’invio per email arriverà con il server di posta della piattaforma.': 'Notifications arrive in the bell at the top. Email delivery will come with the mail server of the platform.',
  'Avvisi della piattaforma': 'Platform alerts',
  'Aggiornamenti dei plugin, errori dei servizi': 'Plugin updates, service errors',
  'Inviti in altri tenant': 'Invitations to other tenants',
  'Un Tenant Manager ti invita come ospite': 'A Tenant Manager invites you as a guest',
  'Menzioni e scadenze delle app': 'Mentions and due dates of the apps',
  'Quando le app le pubblicano': 'When the apps publish them',
  'Nell’app': 'In the app',
  '{what}: nell’app': '{what}: in the app',
  '{what}: per email': '{what}: by email',
  'Vale solo per te, subito.': 'It applies only to you, at once.',
  'Automatico (come il sistema)': 'Automatic (like the system)',
  Tema: 'Theme',
  'Vale solo per te, subito. Il tema lo sceglie chi gestisce il tenant.': 'It applies only to you, at once. The theme is chosen by whoever manages the tenant.',
  'La lingua dell’interfaccia e delle app.': 'The language of the interface and of the apps.',
  Sidebar: 'Sidebar',
  'Aperta all’avvio': 'Open at start',
  'Altrimenti solo le icone, con il nome sotto': 'Otherwise only the icons, with the name below',
  'App nella sidebar': 'Apps in the sidebar',
  'Quelle spente restano nella Home e nella ricerca.': 'The ones turned off stay in Home and in the search.',
  '{app} nella sidebar': '{app} in the sidebar',
  'Accedi sempre dal tenant di appartenenza; in quelli in cui sei ospite entri dal selettore in alto.': 'You always sign in to your home tenant; you enter the ones where you are a guest from the switcher at the top.',
  Come: 'As',
  appartenenza: 'home',
  ospite: 'guest',
  Apri: 'Open',
  'Spazio usato da te': 'Space you use',
  'Elementi tuoi': 'Your items',
  'Nessun consumo': 'No usage',
  Tipo: 'Kind',
  Elementi: 'Items',
  Spazio: 'Space',
  'Le quote del tenant le decide l’Administrator: quando ci saranno, qui vedrai anche quanto resta.': 'The Administrator decides the quotas of the tenant: once they exist, you will also see here what is left.',
  Ciao: 'Hello',
}

const KEY = 'msk_lang'
function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'it' || v === 'en') return v
  } catch {
    /* storage non disponibile */
  }
  return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en'
}

let lang: Lang = initial()
document.documentElement.lang = lang
const listeners = new Set<() => void>()

export function setLang(l: Lang) {
  lang = l
  document.documentElement.lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage non disponibile */
  }
  listeners.forEach((f) => f())
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => lang,
  )
}

/** Il testo nella lingua scelta (la chiave e' la frase italiana). */
export function t(it: string, vars: Record<string, string> = {}): string {
  const s = lang === 'en' ? (EN[it] ?? it) : it
  return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}
