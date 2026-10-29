import { watchTableScroll } from './scrollwatch.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { isUnavailable } from '../api.ts'
import { retryDelay } from '../brand.ts'
import '@fontsource/titillium-web/400.css'
import '@fontsource/titillium-web/600.css'
import '@fontsource/titillium-web/700.css'
import './index.css'
import { t } from './i18n.ts'
import { applyTheme } from './theme.ts'
import App from './App.tsx'

applyTheme()

// a query that fails because the server does not answer is tried again until it answers; the other
// errors once
// any change made from the shell (share, restore, delete…) drops the search answers kept in memory
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({ onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['search'] }) }),
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: (n, e) => isUnavailable(e) || n < 1, retryDelay },
  },
})

// while the server does not answer one notice, not one per query; it goes away when an answer arrives
const OFFLINE = 'server-unavailable'
queryClient.getQueryCache().subscribe((ev) => {
  if (ev.type !== 'updated') return
  if (ev.action.type === 'failed' && isUnavailable(ev.action.error))
    toast.warning(t('The server is not responding. Trying again…'), { id: OFFLINE, duration: Infinity })
  else if (ev.action.type === 'success') toast.dismiss(OFFLINE)
})

watchTableScroll()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
