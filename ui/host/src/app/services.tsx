// Toast (sonner), conferme (AlertDialog) e i servizi che il bridge dei plugin usa.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { UiContext, type Ui } from '../ui-context.ts'
import { ConfirmCtx } from './confirm.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Ask {
  message: string
  danger: boolean
  resolve: (v: boolean) => void
}

/** Toast (sonner), conferme (AlertDialog) e i servizi che il bridge dei plugin usa. */
export function UiServices({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const confirm = useCallback(
    (message: string, danger = false) => new Promise<boolean>((resolve) => setAsk({ message, danger, resolve })),
    [],
  )
  const ui: Ui = useMemo(
    () => ({
      toast: (text, error = false) => (error ? toast.error(text) : toast(text)),
      confirm,
      // il dialogo di condivisione non e' ancora nel prototipo
      share: async () => {
        toast.info('La condivisione non e’ ancora nel prototipo: usala dall’app attuale.')
      },
    }),
    [confirm],
  )
  const close = (v: boolean) => {
    ask?.resolve(v)
    setAsk(null)
  }
  return (
    <UiContext.Provider value={ui}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <AlertDialog open={!!ask} onOpenChange={(o) => !o && close(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Conferma</AlertDialogTitle>
              <AlertDialogDescription>{ask?.message}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => close(false)}>Annulla</AlertDialogCancel>
              <AlertDialogAction
                className={ask?.danger ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
                onClick={() => close(true)}
              >
                Conferma
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ConfirmCtx.Provider>
    </UiContext.Provider>
  )
}

