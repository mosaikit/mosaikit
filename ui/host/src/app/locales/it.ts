// Italiano della shell: le chiavi sono gia' le frasi italiane, qui solo le forme plurali e i messaggi
// degli errori del server per codice (`errors.<codice>`, vedi crates/kernel/src/error.rs).

export const IT: Record<string, string> = {
  '{count} selezionate_one': '1 selezionata',
  '{count} selezionate_other': '{count} selezionate',
  '{count} persone_one': '1 persona',
  '{count} persone_other': '{count} persone',
  '{count} nuove_one': '1 nuova',
  '{count} nuove_other': '{count} nuove',
  '{count} elementi_one': '1 elemento',
  '{count} elementi_other': '{count} elementi',
  'errors.bad_request': 'Richiesta non valida',
  'errors.unauthorized': 'Sessione scaduta: accedi di nuovo',
  'errors.forbidden': 'Non hai i permessi per farlo',
  'errors.not_found': 'Non trovato',
  'errors.conflict': 'Esiste già',
  'errors.too_many': 'Troppe richieste: riprova tra poco',
  'errors.internal': 'Errore del server: riprova tra poco',
  'errors.wrong_credentials': 'Utente o password non corretti',
  'errors.too_many_attempts': 'Troppi tentativi falliti: riprova tra qualche minuto',
  'errors.password_too_short': 'La password deve avere almeno 10 caratteri',
  'errors.password_too_simple': 'Password troppo semplice',
  'errors.wrong_password': 'La password attuale non è corretta',
  'errors.wrong_code': 'Codice non valido',
  'errors.admin_door': 'Gli Administrator accedono da «Accesso amministratori»',
}
