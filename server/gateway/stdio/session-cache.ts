/**
 * One worker session per user. The supervisor allows exactly one data connection per user (a second `attach` = `busy`);
 * if two stdio upstreams of a user connect for the first time at the same time, the running `attach` must be shared.
 */
export class SessionCache<S extends { closed: boolean, close(): void }> {
  private sessions = new Map<string, S>()
  private pending = new Map<string, Promise<S>>()

  /** Open session, otherwise the running `attach` request, otherwise a new one. Failures are not remembered. */
  get(userId: string, attach: () => Promise<S>): Promise<S> {
    const s = this.sessions.get(userId)
    if (s && !s.closed) return Promise.resolve(s)
    let p = this.pending.get(userId)
    if (!p) {
      p = attach().then((n) => { this.sessions.set(userId, n); return n }).finally(() => this.pending.delete(userId))
      this.pending.set(userId, p)
    }
    return p
  }

  /** Closes and forgets a user's session. */
  close(userId: string): void {
    this.sessions.get(userId)?.close()
    this.sessions.delete(userId)
  }

  closeAll(): void {
    for (const s of this.sessions.values()) s.close()
    this.sessions.clear()
  }
}
