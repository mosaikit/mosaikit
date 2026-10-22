// Toasts (sonner), confirmations (AlertDialog) and the services the bridge of the plugins uses.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { UiContext, type Ui } from '../ui-context.ts'
import { ConfirmCtx } from './confirm.ts'
import { t } from './i18n.ts'
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

/** Toasts (sonner), confirmations (AlertDialog) and the services the bridge of the plugins uses. */
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
      // the share dialog is opened by the page of the plugin, which knows the tenant (PluginPage)
      share: async () => {},
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
              <AlertDialogTitle>{t('Confirm')}</AlertDialogTitle>
              <AlertDialogDescription>{ask?.message}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => close(false)}>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className={ask?.danger ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
                onClick={() => close(true)}
              >
                {t('Confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ConfirmCtx.Provider>
    </UiContext.Provider>
  )
}

