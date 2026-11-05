// The comments of a resource, native to the shell: a page that sets `comments.resource` in `msk.band.set`
// gets the comments button of the band, its badge and a panel from the shell, and no code of its own. The state
// (panel open, number of comments) is kept here, outside React, so the button of the band and the panel share it.

import { useSyncExternalStore } from 'react'

export interface CommentView {
  id: string
  author_id: string
  author_name: string
  body: string
  created_at: string
  mine: boolean
  can_delete: boolean
}

interface State {
  open: boolean
  count: number | null
}

let state: State = { open: false, count: null }
const listeners = new Set<() => void>()
const publish = (s: State) => {
  state = s
  listeners.forEach((l) => l())
}

export const setCommentsOpen = (open: boolean) => publish({ ...state, open })
export const toggleComments = () => publish({ ...state, open: !state.open })
export const setCommentsCount = (count: number | null) => publish({ ...state, count })
/** a new resource (or none): the panel is closed and the count forgotten */
export const resetComments = () => publish({ open: false, count: null })

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useCommentsState(): State {
  return useSyncExternalStore(subscribe, () => state)
}
