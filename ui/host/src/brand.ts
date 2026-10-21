import { useEffect, useState } from 'react'
import { api } from './api.ts'

/** Marchio del prodotto (`brand.toml` della distribuzione). */
export interface Brand {
  name: string
  version: string
  kernel_version: string
  tagline: string
  login_message: string
  footer: string
  support_url: string | null
  /** c'e' un logo del marchio (altrimenti il simbolo di Mosaikit) */
  logo: boolean
}

export const DEFAULT_BRAND: Brand = {
  name: 'Mosaikit',
  version: '',
  kernel_version: '',
  tagline: '',
  login_message: '',
  footer: '',
  support_url: null,
  logo: false,
}

let pending: Promise<Brand> | null = null

export function loadBrand(): Promise<Brand> {
  pending ??= api<Brand>('GET', '/api/brand').catch(() => DEFAULT_BRAND)
  return pending
}

export function useBrand(): Brand {
  const [b, setB] = useState<Brand>(DEFAULT_BRAND)
  useEffect(() => {
    let live = true
    void loadBrand().then((x) => {
      if (live) {
        setB(x)
        document.title = x.name
      }
    })
    return () => {
      live = false
    }
  }, [])
  return b
}
