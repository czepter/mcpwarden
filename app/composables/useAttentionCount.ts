import { upstreamApi } from '~/api'

/** Number of upstreams with degraded, open, auth_expired or a pending setup (navigation badge, like the attention list). */
export function useAttentionCount() {
  const count = useState('attention-count', () => 0)
  async function refresh() {
    try { count.value = (await upstreamApi.list()).items.filter(u => ['degraded', 'open', 'auth_expired'].includes(u.status) || u.setup !== 'ready').length } catch { /* Badge bleibt */ }
  }
  return { count, refresh }
}
