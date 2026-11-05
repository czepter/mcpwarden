/**
 * Eine Worker-Sitzung je Nutzer. Der Supervisor erlaubt genau eine Datenverbindung je Nutzer (zweiter `attach` = `busy`);
 * verbinden sich zwei stdio-Upstreams eines Nutzers gleichzeitig zum ersten Mal, muss der laufende `attach` geteilt werden.
 */
export class SessionCache<S extends { closed: boolean, close(): void }> {
  private sessions = new Map<string, S>()
  private pending = new Map<string, Promise<S>>()

  /** Offene Sitzung, sonst die laufende `attach`-Anfrage, sonst eine neue. Fehlschlaege werden nicht gemerkt. */
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

  /** Schliesst und vergisst die Sitzung eines Nutzers. */
  close(userId: string): void {
    this.sessions.get(userId)?.close()
    this.sessions.delete(userId)
  }

  closeAll(): void {
    for (const s of this.sessions.values()) s.close()
    this.sessions.clear()
  }
}
