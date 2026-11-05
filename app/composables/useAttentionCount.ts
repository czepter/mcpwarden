import { upstreamApi } from '~/api'

/** Zahl der Upstreams mit degraded, open, auth_expired oder wartendem Setup (Navigations-Badge, wie die Aufmerksamkeitsliste). */
export function useAttentionCount() {
  const count = useState('attention-count', () => 0)
  async function refresh() {
    try { count.value = (await upstreamApi.list()).items.filter(u => ['degraded', 'open', 'auth_expired'].includes(u.status) || u.setup !== 'ready').length } catch { /* Badge bleibt */ }
  }
  return { count, refresh }
}
