// ponytail: process-wide, single-instance assumption. For multiple instances, solve at the DB level (advisory lock).
let tail: Promise<unknown> = Promise.resolve()

export function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => {})
  return run
}
