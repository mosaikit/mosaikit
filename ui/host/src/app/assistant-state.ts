// Open or closed state of the assistant panel, outside React (the icon, the panel and the bridge share it).
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()
const publish = (v: boolean) => {
  open = v
  listeners.forEach((l) => l())
}
export const toggleAssistant = () => publish(!open)
export const closeAssistant = () => publish(false)
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useAssistantOpen = () => useSyncExternalStore(subscribe, () => open)
