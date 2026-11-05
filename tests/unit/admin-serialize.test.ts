import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/mcp/notify', () => ({ notifyToolsChanged: vi.fn(), closeUserStreams: vi.fn(async () => {}) }))
vi.mock('../../server/utils/user-lifecycle', () => ({ runUserBanned: vi.fn(async () => {}), runUserDeleted: vi.fn(async () => {}), runUserDisabled: vi.fn(async () => {}) }))
vi.mock('../../server/utils/audit', () => ({ audit: vi.fn(async () => {}) }))

const { adminBan, admitAdminAction } = await import('../../server/gateway/service')
type Rt = Parameters<typeof adminBan>[0]

/** Two active admins; `banUser` bans and additionally revokes the target's session like Better Auth. */
function world() {
  const users = new Map([['a1', { id: 'a1', role: 'admin', banned: false, email: 'a1@x' }], ['a2', { id: 'a2', role: 'admin', banned: false, email: 'a2@x' }]])
  const sessions = new Set(['a1', 'a2'])
  const rt = {
    repo: {
      getUserLite: async (id: string) => users.get(id) ?? null,
      activeAdminCount: async (except?: string) => [...users.values()].filter(u => u.role === 'admin' && !u.banned && u.id !== except).length,
    },
  } as unknown as Rt
  const api = { banUser: async ({ userId }: { userId: string }) => { users.get(userId)!.banned = true; sessions.delete(userId) }, unbanUser: async () => {}, removeUser: async () => {} }
  /** Session resolution of the caller; `delay` makes the sign-in deliberately slow. */
  const login = async (id: string, delay: number) => { await new Promise(r => setTimeout(r, delay)); if (!sessions.has(id)) throw new Error('401'); return { id, role: 'admin' as const } }
  return { rt, api, login }
}

describe('Admin bans: concurrent callers remain what they were on arrival', () => {
  it('a slowly signed-in caller gets last_admin instead of 401 when the winner commits first', async () => {
    const { rt, api, login } = world()
    // a1 signs in quickly and bans a2; a2 finishes signing in only afterwards (without the gate this would be a 401).
    const first = (async () => { const who = await admitAdminAction(login('a1', 1)); return adminBan(rt, who, api, 'a2') })()
    const second = (async () => { const who = await admitAdminAction(login('a2', 40)); return adminBan(rt, who, api, 'a1') })()
    const [r1, r2] = await Promise.allSettled([first, second])
    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('rejected')
    expect((r2 as PromiseRejectedResult).reason.data.code).toBe('last_admin')
  })
  it('every sign-in order: exactly one success, exactly one last_admin, never a 401', async () => {
    for (const [d1, d2] of [[1, 40], [40, 1], [5, 5], [0, 0]] as const) {
      const { rt, api, login } = world()
      const run = async (me: string, other: string, d: number) => { const who = await admitAdminAction(login(me, d)); return adminBan(rt, who, api, other) }
      const res = await Promise.allSettled([run('a1', 'a2', d1), run('a2', 'a1', d2)])
      const ok = res.filter(r => r.status === 'fulfilled')
      const bad = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(ok, `${d1}/${d2}`).toHaveLength(1)
      expect(bad.map(b => b.reason.data?.code ?? String(b.reason)), `${d1}/${d2}`).toEqual(['last_admin'])
    }
  })
})
