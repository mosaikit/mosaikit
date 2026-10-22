// The request for confirmation (UiServices shows the dialog).

import { createContext, useContext } from 'react'

export const ConfirmCtx = createContext<(message: string, danger?: boolean) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)
