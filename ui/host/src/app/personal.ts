// Preferences that follow the person everywhere (`/api/me/prefs`): high contrast. The page applies the
// change at once and keeps the session in step, so every tab and device gets it at the next start.

import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errText } from '../api.ts'
import type { PersonPrefs, Session } from '../types.ts'
import { setContrast } from './theme.ts'

export function useSetContrast() {
  const qc = useQueryClient()
  return async (on: boolean) => {
    setContrast(on)
    try {
      const me = await api<PersonPrefs>('PUT', '/api/me/prefs', { contrast: on })
      qc.setQueryData<Session | null>(['session'], (s) => (s ? { ...s, me } : s))
    } catch (e) {
      setContrast(!on)
      toast.error(errText(e))
    }
  }
}
