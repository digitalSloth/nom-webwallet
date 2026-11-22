import type { Component } from 'vue'
import type { RouteLocationRaw, RouteRecordNameGeneric } from 'vue-router'
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CoinsIcon,
  GiftIcon,
  HistoryIcon,
  LandmarkIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LinkIcon,
  ZapIcon,
} from 'lucide-vue-next'

export interface NavItem {
  group: 'wallet' | 'network'
  label: string
  icon: Component
  to: RouteLocationRaw
  badge?: 'unreceived' // the Sidebar shows useAccount's unreceivedCount when above 0
  routes?: readonly string[] // other route names that highlight this item
}

export function isNavItemActive(
  item: NavItem,
  routeName: RouteRecordNameGeneric | null | undefined
): boolean {
  if (typeof routeName !== 'string') return false
  const to = item.to
  const ownName = typeof to === 'object' && 'name' in to ? to.name : undefined
  return routeName === ownName || (item.routes?.includes(routeName) ?? false)
}

export const navItems: NavItem[] = [
  { group: 'wallet', label: 'Dashboard', icon: LayoutDashboardIcon, to: { name: 'home' } },
  { group: 'wallet', label: 'Send', icon: ArrowUpRightIcon, to: { name: 'send' } },
  {
    group: 'wallet',
    label: 'Receive',
    icon: ArrowDownLeftIcon,
    to: { name: 'receive' },
    badge: 'unreceived',
  },
  { group: 'wallet', label: 'Activity', icon: HistoryIcon, to: { name: 'activity' } },
  { group: 'wallet', label: 'Plasma', icon: ZapIcon, to: { name: 'plasma' } },
  { group: 'wallet', label: 'Connected apps', icon: LinkIcon, to: { name: 'apps' } },
  { group: 'network', label: 'Rewards', icon: GiftIcon, to: { name: 'rewards' } },
  { group: 'network', label: 'Pillars', icon: LandmarkIcon, to: { name: 'pillars' } },
  { group: 'network', label: 'Staking', icon: LayersIcon, to: { name: 'staking' } },
  {
    group: 'network',
    label: 'Tokens',
    icon: CoinsIcon,
    to: { name: 'tokens' },
    routes: ['token-issue'],
  },
]
