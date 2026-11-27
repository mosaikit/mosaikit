// Shared interface services: toasts, confirmations, sharing.

import { createContext, useContext } from 'react'

export interface SharePre {
  principals: { type: 'user' | 'group' | 'all'; id: string; name?: string }[]
  level: 'read' | 'write' | 'manage'
}

/** What a plugin asks the picker of people and groups (`msk.pickPrincipals`). */
export interface PickOptions {
  /** what may be chosen (default both) */
  kind?: 'user' | 'group' | 'both'
  /** people and groups that are already there: not offered */
  exclude?: { type: 'user' | 'group' | 'all'; id: string }[]
  /** `false`: one choice only (default true) */
  multiple?: boolean
  title?: string
}

export interface PickedPrincipal {
  type: 'user' | 'group' | 'all'
  id: string
  name: string
}

export interface ConfirmAction {
  title: string
  /** what the action does, one sentence */
  lead?: string
  /** the app it works in */
  app?: string
  rows: { label: string; value: string; long?: boolean }[]
  confirm?: string
}

export interface Ui {
  toast: (text: string, error?: boolean) => void
  confirm: (message: string, danger?: boolean) => Promise<boolean>
  /** A confirmation that shows what is going to be done as a list of «label: value», not a sentence (the changes the assistant proposes). */
  confirmAction: (a: ConfirmAction) => Promise<boolean>
  /** `pre`: people and groups the dialog starts with, ready to be shared with (the person confirms) */
  share: (resourceId: string, pre?: SharePre) => Promise<void>
  /** a picker of the people and groups of the tenant; empty when the person cancels */
  pickPrincipals: (opts?: PickOptions) => Promise<PickedPrincipal[]>
  /** opens the page of a plugin of the tenant, at a place inside it */
  open: (plugin: string, at?: string) => void
}

export const UiContext = createContext<Ui>({
  toast: () => {},
  confirm: async () => false,
  confirmAction: async () => false,
  share: async () => {},
  pickPrincipals: async () => [],
  open: () => {},
})

export const useUi = () => useContext(UiContext)
