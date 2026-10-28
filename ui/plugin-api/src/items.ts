/** Small pieces the plugins share for drawing items (see `CrudView`): initials in a coloured circle, and a status chip. */

/** The initials of a name: first letters of the first and the last word (one for a single word). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const first = [...words[0]!][0]!
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : ''
  return (first + last).toLocaleUpperCase()
}

/** A circle with the initials of `name`; the colour comes from the name, so a person keeps theirs. */
export function avatar(name: string, big = false): HTMLElement {
  let hue = 0
  for (const c of name) hue = (hue * 31 + c.codePointAt(0)!) % 360
  const e = document.createElement('span')
  e.className = 'msk-avatar' + (big ? ' big' : '')
  e.style.setProperty('--h', String(hue))
  e.setAttribute('aria-hidden', 'true')
  e.textContent = initials(name)
  return e
}

/** A chip with a coloured dot: `tone` is `ok`, `err`, `acc` or nothing (neutral). */
export function chip(text: string, tone: 'ok' | 'err' | 'acc' | '' = ''): HTMLElement {
  const e = document.createElement('span')
  e.className = 'msk-chip' + (tone ? ' ' + tone : '')
  e.textContent = text
  return e
}
