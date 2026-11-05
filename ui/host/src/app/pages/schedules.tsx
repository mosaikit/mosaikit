// Schedules of the tenant (docs/architecture.md, "Schedules"): the jobs the people of the tenant put on a
// timetable, for the Tenant Manager. One row per schedule: what it is, who set it, when it runs next and how the
// last run ended, with the actions the rules allow a manager (pause, resume, run now, delete).

import { Pause, Play, PlayCircle, Trash2 } from 'lucide-react'
import { api, fmtDate } from '../../api.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAction, useApi, useConfirm, useTenantCtx } from '../core.ts'
import { t } from '../i18n.ts'
import { Empty, ErrorBox, FillBody, FillPage, Loading, PageHeader } from '../kit.tsx'

const enc = encodeURIComponent

export interface ScheduleRow {
  id: string
  plugin: string
  name: string
  label: string
  author: string
  author_name: string
  cron: string
  time_zone: string
  status: 'active' | 'paused'
  paused_reason: string | null
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
}

/** Why a schedule is paused, in words. */
function why(reason: string | null): string {
  switch (reason) {
    case 'author':
      return t('Paused by its author')
    case 'manager':
      return t('Paused by a manager')
    case 'author_inactive':
      return t('Its author left or was suspended')
    case 'failures':
      return t('Stopped after repeated failures')
    case 'plugin_off':
      return t('The plugin is off')
    case 'command_removed':
      return t('The plugin no longer offers it')
    default:
      return t('Paused')
  }
}

export function SchedulesPage({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const confirm = useConfirm()
  const key = ['schedules', slug]
  const q = useApi<ScheduleRow[]>(key, ctx.data?.tenant.role === 'tenant_manager' ? `/api/t/${enc(slug)}/schedules` : null)
  const label = (id: string) => ctx.data?.plugins.find((p) => p.id === id)?.label ?? id.split('.').pop() ?? id
  const useVerb = (verb: 'pause' | 'resume' | 'run', ok: string) => useAction((id: string) => api('POST', `/api/t/${enc(slug)}/schedules/${enc(id)}/${verb}`), { ok, invalidate: [key] })
  const pause = useVerb('pause', t('Paused'))
  const resume = useVerb('resume', t('Resumed'))
  const run = useVerb('run', t('Started'))
  const remove = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/schedules/${enc(id)}`), { ok: t('Deleted'), invalidate: [key] })
  if (ctx.isLoading) return <Loading />
  if (ctx.data?.tenant.role !== 'tenant_manager') return <Empty title={t('Reserved to Tenant Managers')} />
  const rows = q.data ?? []
  return (
    <FillPage>
      <PageHeader title={t('Schedules')} crumbs={[{ label: t('Tenant management') }]} sub={t('The jobs the people of {name} have put on a timetable', { name: ctx.data?.tenant.name ?? '' })} />
      <FillBody className="flex flex-col gap-3 p-6 max-[620px]:p-4">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty art="tasks" title={t('No schedules yet')}>
            {t('A person sets one up from the page of a plugin that offers it; it then appears here.')}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Schedule')}</TableHead>
                <TableHead>{t('Plugin')}</TableHead>
                <TableHead>{t('Set by')}</TableHead>
                <TableHead>{t('Timetable')}</TableHead>
                <TableHead>{t('Next run')}</TableHead>
                <TableHead>{t('Last run')}</TableHead>
                <TableHead>{t('State')}</TableHead>
                <TableHead className="text-right">{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.label || s.name}</TableCell>
                  <TableCell>{label(s.plugin)}</TableCell>
                  <TableCell>{s.author_name}</TableCell>
                  <TableCell>
                    <code className="text-xs">{s.cron}</code> <span className="text-xs text-muted-foreground">{s.time_zone}</span>
                  </TableCell>
                  <TableCell>{s.status === 'active' ? fmtDate(s.next_run_at) : '—'}</TableCell>
                  <TableCell>
                    {fmtDate(s.last_run_at)} {s.last_status && <Badge variant={s.last_status === 'succeeded' ? 'secondary' : 'destructive'}>{s.last_status}</Badge>}
                  </TableCell>
                  <TableCell>{s.status === 'active' ? <Badge>{t('Active')}</Badge> : <Badge variant="outline">{why(s.paused_reason)}</Badge>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {s.status === 'active' ? (
                      <Button variant="ghost" size="icon" aria-label={t('Pause')} title={t('Pause')} onClick={() => pause.mutate(s.id)}>
                        <Pause aria-hidden="true" />
                      </Button>
                    ) : (
                      // the author's own pause and a removed author are theirs to undo: the server says so
                      <Button variant="ghost" size="icon" aria-label={t('Resume')} title={t('Resume')} onClick={() => resume.mutate(s.id)}>
                        <Play aria-hidden="true" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" aria-label={t('Run now')} title={t('Run now')} onClick={() => run.mutate(s.id)}>
                      <PlayCircle aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('Delete')}
                      title={t('Delete')}
                      onClick={async () => (await confirm(t('Delete this schedule? Its history is deleted with it.'), true)) && remove.mutate(s.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FillBody>
    </FillPage>
  )
}
