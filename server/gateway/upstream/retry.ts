import { RETRY } from '../config'

export type RetryOptions = {
  attempts?: number
  baseMs?: number
  capMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  shouldRetry?: (e: unknown) => boolean
  signal?: AbortSignal
}

/** Retry nur für Connect/Init/List (nie für tools/call). Exponentiell, Jitter, Deckel. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions = {}): Promise<{ value: T, retries: number }> {
  const attempts = o.attempts ?? RETRY.attempts
  const sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const rnd = o.random ?? Math.random
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try { return { value: await fn(i), retries: i } } catch (e) {
      last = e
      if (i === attempts - 1 || o.signal?.aborted || (o.shouldRetry && !o.shouldRetry(e))) break
      const exp = Math.min((o.baseMs ?? RETRY.baseMs) * 2 ** i, o.capMs ?? RETRY.capMs)
      await sleep(Math.round(exp * (0.5 + rnd() * 0.5)))
    }
  }
  throw last
}
