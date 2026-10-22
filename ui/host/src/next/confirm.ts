// La richiesta di conferma (il dialogo lo mostra UiServices).

import { createContext, useContext } from 'react'

export const ConfirmCtx = createContext<(message: string, danger?: boolean) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)
