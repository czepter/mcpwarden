import { upstreamApi } from '~/api'

/** Zahl der Upstreams mit degraded, open oder auth_expired (Navigations-Badge). */
export function useAttentionCount() {
  const count = useState('attention-count', () => 0)
  async function refresh() {
    try { count.value = (await upstreamApi.list()).items.filter(u => ['degraded', 'open', 'auth_expired'].includes(u.status)).length } catch { /* Badge bleibt */ }
  }
  return { count, refresh }
}
