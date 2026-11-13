// The standard «loading» spinner of a plugin page: `msk.busy(true)` shows it, `msk.busy(false)` hides it, and
// `msk.loading(promise)` does both around a piece of work. It looks the same in every plugin (the ring of the host)
// and never blocks the page: the overlay lets the pointer through. Calls are counted (two views loading at once keep
// it on until both are done), it appears only if the work lasts a little (no flash for a fast answer), and an
// unhandled error of the page turns it off, so a plugin that forgets `busy(false)` after a failure is not stuck.

const DELAY_MS = 150

let count = 0
let timer: ReturnType<typeof setTimeout> | undefined
let box: HTMLElement | null = null
let watching = false

function hide() {
  if (timer) clearTimeout(timer)
  timer = undefined
  box?.remove()
  box = null
}

function show(label: string) {
  if (box || typeof document === 'undefined') return
  box = document.createElement('div')
  box.className = 'msk-busy'
  box.setAttribute('role', 'status')
  box.setAttribute('aria-live', 'polite')
  const ring = document.createElement('span')
  ring.className = 'msk-busy-ring'
  ring.setAttribute('aria-hidden', 'true')
  const text = document.createElement('span')
  text.className = 'msk-busy-text'
  text.textContent = label
  box.append(ring, text)
  document.body.append(box)
}

/** Turns the spinner on or off. `label` is the text for a screen reader and under the ring. */
export function setBusy(on: boolean, label: string) {
  if (typeof window !== 'undefined' && !watching) {
    watching = true
    const reset = () => {
      count = 0
      hide()
    }
    window.addEventListener('error', reset)
    window.addEventListener('unhandledrejection', reset)
  }
  if (on) {
    count++
    if (!box && !timer) timer = setTimeout(() => ((timer = undefined), count > 0 && show(label)), DELAY_MS)
    return
  }
  count = Math.max(0, count - 1)
  if (count === 0) hide()
}

/** The spinner is on while `work` (a promise, or a function that returns one) runs, and off at the end, also on an error. */
export async function withBusy<T>(work: Promise<T> | (() => Promise<T>), label: string): Promise<T> {
  setBusy(true, label)
  try {
    return await (typeof work === 'function' ? work() : work)
  } finally {
    setBusy(false, label)
  }
}

/** For the tests: the state back to nothing. */
export function resetBusy() {
  count = 0
  hide()
}
