// ponytail: prozessweit, Single-Instance-Annahme. Bei Mehrfachinstanzen auf DB-Ebene loesen (Advisory Lock).
let tail: Promise<unknown> = Promise.resolve()

export function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => {})
  return run
}
