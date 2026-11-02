// Hover-to-open for the menus of the closed sidebar. `createHoverController` is the pure timer logic (open
// after a short delay so a fast pass does nothing, close after a grace delay so the pointer can travel from the
// icon to the menu); `useHoverMenu` wires it to a controlled Radix menu.
import { useEffect, useMemo, useRef, useState } from 'react'

export const HOVER_OPEN_MS = 150
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
      if (!isOpen) timer = setTimeout(() => set(true), openMs)
    },
    /** the pointer left both */
    leave(isOpen: boolean) {
      clear()
      if (isOpen) timer = setTimeout(() => set(false), closeMs)
    },
    cancel: clear,
  }
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
  const openRef = useRef(false)
  const keepOnClick = useRef(false)

  useEffect(() => {
    openRef.current = open
  }, [open])
  const ctl = useMemo(
    () =>
      createHoverController((o) => {
        if (o) setViaHover(true)
        setOpenState(o)
      }),
    [],
  )
  useEffect(() => ctl.cancel, [ctl])
  const mouse = (e: React.PointerEvent) => enabled && e.pointerType !== 'touch'
  return {
    open,
    viaHover,
    onOpenChange: (o) => {
      ctl.cancel()
      // a click on the icon of a menu the pointer opened keeps it open (and makes it a normal one)
      if (!o && keepOnClick.current && viaHover) {
        keepOnClick.current = false
        setViaHover(false)
        return
      }
      keepOnClick.current = false
      if (o) setViaHover(false)
      setOpenState(o)
    },
    areaProps: {
      onPointerEnter: (e) => mouse(e) && ctl.enter(openRef.current),
      onPointerLeave: (e) => mouse(e) && viaHover && ctl.leave(openRef.current),
      onPointerDownCapture: (e) => {
        // only a press on the trigger of the menu (not on the link of the app) keeps it open
        keepOnClick.current = openRef.current && viaHover && !!(e.target as HTMLElement).closest?.('[aria-haspopup="menu"]')
      },
    },
    contentProps: {
      onPointerEnter: (e) => mouse(e) && ctl.enter(true),
      onPointerLeave: (e) => mouse(e) && viaHover && ctl.leave(true),
    },
  }
}
