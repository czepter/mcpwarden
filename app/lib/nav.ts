import type { Role } from '#shared/api-types'
import { Activity, FileText, House, KeyRound, LayoutGrid, Monitor, ShieldCheck, SlidersHorizontal } from '@lucide/vue'
import type { Component } from 'vue'

export type NavItem = { label: string, to: string, icon: Component, adminOnly?: boolean, badge?: 'attention' }
export type NavGroup = { label: string | null, items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'Betrieb', items: [
    { label: 'Dashboard', to: '/', icon: House },
    { label: 'Upstreams', to: '/upstreams', icon: LayoutGrid, badge: 'attention' },
    { label: 'Statistik', to: '/stats', icon: Activity },
  ] },
  { label: 'Zugang', items: [
    { label: 'Clients', to: '/settings/connections', icon: Monitor },
    { label: 'Tokens', to: '/settings/tokens', icon: KeyRound },
  ] },
  { label: 'System', items: [
    { label: 'Audit', to: '/audit', icon: FileText },
    { label: 'Admin', to: '/admin/users', icon: ShieldCheck, adminOnly: true },
  ] },
]
export const NAV_SETTINGS: NavItem = { label: 'Einstellungen', to: '/settings', icon: SlidersHorizontal }

export function navFor(role: Role | undefined): NavGroup[] {
  return NAV.map(g => ({ ...g, items: g.items.filter(i => !i.adminOnly || role === 'admin') })).filter(g => g.items.length)
}
/** Aktiv: exakter Pfad; Unterpfade zaehlen, ausser fuer `/` und `/settings` (eigene Eintraege darunter). */
export function isActive(item: NavItem, path: string): boolean {
  if (item.to === '/') return path === '/'
  if (item.to === '/settings') return path === '/settings'
  if (item.to === '/admin/users') return path.startsWith('/admin')
  return path === item.to || path.startsWith(item.to + '/')
}
