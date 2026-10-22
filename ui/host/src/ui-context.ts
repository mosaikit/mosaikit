// Shared interface services: toasts, confirmations, sharing.

import { createContext, useContext } from 'react'

export interface Ui {
  toast: (text: string, error?: boolean) => void
  confirm: (message: string, danger?: boolean) => Promise<boolean>
  share: (resourceId: string) => Promise<void>
}

export const UiContext = createContext<Ui>({
  toast: () => {},
  confirm: async () => false,
  share: async () => {},
})

export const useUi = () => useContext(UiContext)
