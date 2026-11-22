// «Who can see this» on a detail header: the avatar stack of the people it is shared with and a button that opens
// the share dialog of the host (`msk.share(id)`); optionally a copy-link action. Display only: the host checks
// every right.
import { h } from './dom.ts'
import { avatarStack } from './kit.ts'

export interface ShareChipOptions {
  /** the names of the people and groups with access, as you want them shown */
  names: string[]
  /** opens the share dialog: `() => msk.share(id)` */
  onOpen?: () => void
  /** the person cannot manage the sharing: the chip shows the people but is not a button */
  readonly?: boolean
  /** adds a «copy link» button; the plugin gives the link */
  copyLink?: () => string | Promise<string>
  labels?: { private?: string; shared?: string; share?: string; copy?: string; copied?: string }
}

export interface ShareChip {
  el: HTMLElement
  set: (names: string[]) => void
}

/** `Only you` / `Shared with 3` plus the avatars; a click opens the share dialog. */
export function shareChip(opts: ShareChipOptions): ShareChip {
  const labels = { private: 'Only you', shared: 'Shared with {n}', share: 'Share', copy: 'Copy link', copied: 'Link copied', ...opts.labels }
  const root = h('span', { class: 'msk-sharechip' })
  const clickable = !!opts.onOpen && !opts.readonly
  const main = clickable ? h('button', { class: 'msk-sharemain', type: 'button' }) : h('span', { class: 'msk-sharemain' })
  if (clickable) main.addEventListener('click', opts.onOpen!)
  root.append(main)
  const set = (names: string[]) => {
    main.replaceChildren()
    const text = names.length ? labels.shared.replace('{n}', String(names.length)) : labels.private
    if (names.length) main.append(avatarStack(names, 3))
    main.append(h('span', { class: 'msk-sharetext' }, text))
    main.setAttribute('aria-label', clickable ? `${labels.share}: ${text}` : text)
    main.dataset.count = String(names.length)
  }
  set(opts.names)
  if (opts.copyLink) {
    const copy = h('button', { class: 'msk-sharecopy', type: 'button', 'aria-label': labels.copy, title: labels.copy })
    copy.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8a3 3 0 0 0 4.2 4.2l.8-.8"/></svg>'
    const live = h('span', { class: 'msk-sr', role: 'status' })
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await opts.copyLink!())
        live.textContent = labels.copied
        copy.classList.add('done')
        setTimeout(() => {
          copy.classList.remove('done')
          live.textContent = ''
        }, 1600)
      } catch {
        live.textContent = ''
      }
    })
    root.append(copy, live)
  }
  return { el: root, set }
}
