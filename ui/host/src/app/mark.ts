// Il simbolo dell'applicazione: una sola sorgente per il logo nell'angolo della shell e per la favicon.
// Con un logo del marchio (brand.toml) entrambi usano quello; altrimenti il simbolo di Mosaikit nel
// colore di accento del tema, che cambia con il tema.

import { useEffect } from 'react'
import { useBrand } from '../brand.ts'
import { useTheme } from './theme.ts'

export function markSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><rect x="7" y="7" width="8" height="8" rx="2" fill="#fff"/><rect x="17" y="7" width="8" height="8" rx="2" fill="#fff" opacity=".55"/><rect x="7" y="17" width="8" height="8" rx="2" fill="#fff" opacity=".55"/><rect x="17" y="17" width="8" height="8" rx="2" fill="#fff"/></svg>`
}

/** Il colore di accento del tema attivo. */
export function accent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#5b5fc7'
}

/** La favicon della pagina segue il logo dell'applicazione (e il tema). */
export function useFavicon() {
  const brand = useBrand()
  const theme = useTheme()
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (brand.logo) {
      link.type = ''
      link.href = 'brand/logo'
    } else {
      link.type = 'image/svg+xml'
      link.href = `data:image/svg+xml,${encodeURIComponent(markSvg(accent()))}`
    }
  }, [brand.logo, theme.preset, theme.mode])
}
