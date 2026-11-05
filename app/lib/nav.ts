import type { Role } from '#shared/api-types'
import { Activity, FileText, House, KeyRound, LayoutGrid, Monitor, ShieldCheck, SlidersHorizontal } from '@lucide/vue'
import type { Component } from 'vue'
import { FEATURES } from './features'

export type NavItem = { label: string, to: string, icon: Component, adminOnly?: boolean, phase2?: boolean, badge?: 'attention' }
export type NavGroup = { label: string | null, items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'Betrieb', items: [
    { label: 'Dashboard', to: '/', icon: House },
    { label: 'Upstreams', to: '/upstreams', icon: LayoutGrid, badge: 'attention' },
    { label: 'Statistik', to: '/stats', icon: Activity, phase2: true },
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

export function navFor(role: Role | undefined, phase2: boolean = FEATURES.phase2): NavGroup[] {
  return NAV.map(g => ({ ...g, items: g.items.filter(i => (!i.adminOnly || role === 'admin') && (!i.phase2 || phase2)) })).filter(g => g.items.length)
}
/** Active: exact path; sub-paths count, except for `/` and `/settings` (own entries below). */
export function isActive(item: NavItem, path: string): boolean {
  if (item.to === '/') return path === '/'
  if (item.to === '/settings') return path === '/settings'
  if (item.to === '/admin/users') return path.startsWith('/admin')
  return path === item.to || path.startsWith(item.to + '/')
}
