import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Unisce le classi Tailwind (le ultime vincono). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
