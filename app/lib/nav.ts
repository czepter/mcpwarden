import type { Role } from '#shared/api-types'
import { Activity, FileText, House, KeyRound, LayoutGrid, Monitor, ShieldCheck, SlidersHorizontal } from '@lucide/vue'
import type { Component } from 'vue'
import { t } from '~/lib/i18n'
import { FEATURES } from './features'

/** `label` holds a translation key; `navFor` / `navSettings` return it resolved. */
export type NavItem = { label: string, to: string, icon: Component, adminOnly?: boolean, phase2?: boolean, badge?: 'attention' }
export type NavGroup = { label: string | null, items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'common.nav.operations', items: [
    { label: 'common.nav.dashboard', to: '/', icon: House },
    { label: 'common.nav.upstreams', to: '/upstreams', icon: LayoutGrid, badge: 'attention' },
    { label: 'common.nav.stats', to: '/stats', icon: Activity },
  ] },
  { label: 'common.nav.access', items: [
    { label: 'common.nav.clients', to: '/settings/connections', icon: Monitor },
    { label: 'common.nav.tokens', to: '/settings/tokens', icon: KeyRound },
  ] },
  { label: 'common.nav.system', items: [
    { label: 'common.nav.audit', to: '/audit', icon: FileText },
    { label: 'common.nav.admin', to: '/admin/users', icon: ShieldCheck, adminOnly: true },
  ] },
]
export const NAV_SETTINGS: NavItem = { label: 'common.nav.settings', to: '/settings', icon: SlidersHorizontal }

export function navFor(role: Role | undefined, phase2: boolean = FEATURES.phase2): NavGroup[] {
  return NAV.map(g => ({ ...g, label: g.label && t(g.label), items: g.items.filter(i => (!i.adminOnly || role === 'admin') && (!i.phase2 || phase2)).map(i => ({ ...i, label: t(i.label) })) })).filter(g => g.items.length)
}
/** Active: exact path; sub-paths count, except for `/` and `/settings` (own entries below). */
export function isActive(item: NavItem, path: string): boolean {
  if (item.to === '/') return path === '/'
  if (item.to === '/settings') return path === '/settings'
  if (item.to === '/admin/users') return path.startsWith('/admin')
  return path === item.to || path.startsWith(item.to + '/')
}
