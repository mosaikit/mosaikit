// Toasts (sonner), confirmations (AlertDialog) and the services the bridge of the plugins uses.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { UiContext, type ConfirmAction, type Ui } from '../ui-context.ts'
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
  /** a list to show instead of the message (see `confirmAction`) */
  action?: ConfirmAction
  resolve: (v: boolean) => void
}

/** Toasts (sonner), confirmations (AlertDialog) and the services the bridge of the plugins uses. */
export function UiServices({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const confirm = useCallback(
    (message: string, danger = false) => new Promise<boolean>((resolve) => setAsk({ message, danger, resolve })),
    [],
  )
  const confirmAction = useCallback((action: ConfirmAction) => new Promise<boolean>((resolve) => setAsk({ message: action.title, danger: false, action, resolve })), [])
  const ui: Ui = useMemo(
    () => ({
      toast: (text, error = false) => (error ? toast.error(text) : toast(text)),
      confirm,
      confirmAction,
      // the share dialog is opened by the page of the plugin, which knows the tenant (PluginPage)
      share: async () => {},
      pickPrincipals: async () => [],
      // opening a plugin page needs the tenant: PluginPage provides it
      open: () => {},
    }),
    [confirm, confirmAction],
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
            {ask?.action ? (
              <div data-testid="confirm-action" className="grid gap-4">
                <AlertDialogHeader>
                  {ask.action.app && (
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      <Sparkles className="size-3.5" aria-hidden="true" />
                      {ask.action.app}
                    </span>
                  )}
                  <AlertDialogTitle className="text-xl">{ask.action.title}</AlertDialogTitle>
                  {ask.action.lead && <AlertDialogDescription>{ask.action.lead}</AlertDialogDescription>}
                </AlertDialogHeader>
                {ask.action.rows.length > 0 && (
                  <dl className="grid max-h-[50vh] gap-3 overflow-auto rounded-xl border bg-muted/40 p-4">
                    {ask.action.rows.map((r) => (
                      <div key={r.label} className="grid gap-0.5">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</dt>
                        <dd className={r.long ? 'max-h-40 overflow-auto rounded-lg border bg-background p-2.5 text-sm break-words whitespace-pre-wrap' : 'text-base font-medium break-words'}>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ) : (
              <AlertDialogHeader>
                <AlertDialogTitle>{t('Confirm')}</AlertDialogTitle>
                <AlertDialogDescription className="break-words whitespace-pre-wrap">{ask?.message}</AlertDialogDescription>
              </AlertDialogHeader>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => close(false)}>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className={ask?.danger ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
                onClick={() => close(true)}
              >
                {ask?.action?.confirm ?? t('Confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ConfirmCtx.Provider>
    </UiContext.Provider>
  )
}

