// Hover-to-open for the menus of the closed sidebar. `createHoverController` is the pure timer logic (open
// at once, close after a grace delay so the pointer can travel from the icon to the menu); `useHoverMenu` wires it to a controlled Radix menu.
import { useEffect, useMemo, useRef, useState } from 'react'

export const HOVER_OPEN_MS = 0
export const HOVER_CLOSE_MS = 150

export function createHoverController(set: (open: boolean) => void, openMs = HOVER_OPEN_MS, closeMs = HOVER_CLOSE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    /** the pointer is over the icon or the menu */
    enter(isOpen: boolean) {
      clear()
      if (isOpen) return
      if (openMs <= 0) set(true)
      else timer = setTimeout(() => set(true), openMs)
    },
    /** the pointer left both */
    leave(isOpen: boolean) {
      clear()
      if (isOpen) timer = setTimeout(() => set(false), closeMs)
    },
    cancel: clear,
  }
}

// One menu of the rail is open at a time: when a menu opens, the one that was open closes at once.
let closeActive: (() => void) | null = null
function becomeActive(close: () => void) {
  if (closeActive && closeActive !== close) closeActive()
  closeActive = close
}
function noLongerActive(close: () => void) {
  if (closeActive === close) closeActive = null
}

export interface HoverMenu {
  open: boolean
  /** true when the menu was opened by the pointer: it must not take the focus */
  viaHover: boolean
  onOpenChange: (open: boolean) => void
  /** for the element that holds the icon (and its small arrow) */
  areaProps: { onPointerEnter: (e: React.PointerEvent) => void; onPointerLeave: (e: React.PointerEvent) => void; onPointerDownCapture: (e: React.PointerEvent) => void }
  /** for the menu content */
  contentProps: { onPointerEnter: (e: React.PointerEvent) => void; onPointerLeave: (e: React.PointerEvent) => void }
}

export function useHoverMenu(enabled: boolean): HoverMenu {
  const [open, setOpenState] = useState(false)
  const [viaHover, setViaHover] = useState(false)
  // refs follow the state at once: a press can come in the same tick as the pointer enter, before a render
  const openRef = useRef(false)
  const viaRef = useRef(false)
  const keepOnClick = useRef(false)
  // a press on the entry (it navigates) mutes the hover until the pointer has left the entry
  const muted = useRef(false)

  // closes this menu from outside (another one opened): no timer, no focus change
  const closeNow = useRef(() => {})
  // the timer fires later, in an event: the refs are not read while rendering
  // oxlint-disable-next-line react/preserve-manual-memoization
  const ctl = useMemo(
    () =>
      // oxlint-disable-next-line react/refs
      createHoverController((o) => {
        if (o) {
          becomeActive(closeNow.current)
          setViaHover(true)
          viaRef.current = true
        } else noLongerActive(closeNow.current)
        openRef.current = o
        setOpenState(o)
      }),
    [],
  )
  useEffect(() => {
    closeNow.current = () => {
      ctl.cancel()
      openRef.current = false
      viaRef.current = false
      setViaHover(false)
      setOpenState(false)
    }
    const close = closeNow.current
    return () => {
      ctl.cancel()
      noLongerActive(close)
    }
  }, [ctl])
  const mouse = (e: React.PointerEvent) => enabled && e.pointerType !== 'touch'
  return {
    open,
    viaHover,
    onOpenChange: (o) => {
      ctl.cancel()
      // a click on the icon of a menu that is already open keeps it open (and makes it a normal one)
      if (!o && keepOnClick.current) {
        keepOnClick.current = false
        viaRef.current = false
        setViaHover(false)
        return
      }
      keepOnClick.current = false
      if (o) {
        viaRef.current = false
        setViaHover(false)
        becomeActive(closeNow.current)
      } else noLongerActive(closeNow.current)
      openRef.current = o
      setOpenState(o)
    },
    areaProps: {
      onPointerEnter: (e) => mouse(e) && !muted.current && ctl.enter(openRef.current),
      onPointerLeave: (e) => {
        muted.current = false
        if (mouse(e) && viaRef.current) ctl.leave(openRef.current)
      },
      onPointerDownCapture: (e) => {
        ctl.cancel()
        muted.current = true
        // only a press on the trigger of the menu (not on the link of the app) keeps it open
        const onTrigger = !!(e.target as HTMLElement).closest?.('[aria-haspopup="menu"]')
        keepOnClick.current = openRef.current && onTrigger
        // a press on the icon (its link) goes where the link goes and the menu stays open: from now on it is a normal one
        // (it closes with a click outside or Escape, not when the pointer leaves)
        if (openRef.current && viaRef.current && !onTrigger) {
          viaRef.current = false
          setViaHover(false)
        }
      },
    },
    contentProps: {
      onPointerEnter: (e) => mouse(e) && ctl.enter(true),
      onPointerLeave: (e) => mouse(e) && viaRef.current && ctl.leave(true),
    },
  }
}
