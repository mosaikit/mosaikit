// Shared interface services: toasts, confirmations, sharing.

import { createContext, useContext } from 'react'

export interface SharePre {
  principals: { type: 'user' | 'group'; id: string; name?: string }[]
  level: 'read' | 'write' | 'manage'
}

export interface Ui {
  toast: (text: string, error?: boolean) => void
  confirm: (message: string, danger?: boolean) => Promise<boolean>
  /** `pre`: people and groups the dialog starts with, ready to be shared with (the person confirms) */
  share: (resourceId: string, pre?: SharePre) => Promise<void>
  /** opens the page of a plugin of the tenant, at a place inside it */
  open: (plugin: string, at?: string) => void
}

export const UiContext = createContext<Ui>({
  toast: () => {},
  confirm: async () => false,
  share: async () => {},
  open: () => {},
})

export const useUi = () => useContext(UiContext)
