import { describe, expect, it } from 'vitest'
import { isNavItemActive, navItems } from './nav'
import type { NavItem } from './nav'
import { must } from '@/test/must'

describe('navItems', () => {
  it('orders the wallet group with Activity after Receive and Connected apps last', () => {
    const labels = navItems.filter((item) => item.group === 'wallet').map((item) => item.label)

    expect(labels).toEqual(['Dashboard', 'Send', 'Receive', 'Activity', 'Plasma', 'Connected apps'])
    expect(navItems[3]).toMatchObject({ group: 'wallet', to: { name: 'activity' } })
  })

  it('links Connected apps to the apps route', () => {
    expect(navItems.find((item) => item.label === 'Connected apps')?.to).toEqual({ name: 'apps' })
  })

  it('orders the network group with Tokens after Staking', () => {
    const labels = navItems.filter((item) => item.group === 'network').map((item) => item.label)

    expect(labels).toEqual(['Rewards', 'Pillars', 'Staking', 'Tokens'])
    expect(navItems.find((item) => item.label === 'Tokens')?.to).toEqual({ name: 'tokens' })
  })
})

describe('Tokens nav item', () => {
  const tokens = must(navItems.find((item) => item.label === 'Tokens'))

  it.each(['tokens', 'token-issue'])('is active on %s', (name) => {
    expect(isNavItemActive(tokens, name)).toBe(true)
  })

  it('is inactive on another route', () => {
    expect(isNavItemActive(tokens, 'rewards')).toBe(false)
  })
})

describe('isNavItemActive', () => {
  const item: NavItem = {
    group: 'network',
    label: 'Test',
    icon: {},
    to: { name: 'own' },
    routes: ['extra'],
  }

  it.each(['own', 'extra'])('is true for %s', (name) => {
    expect(isNavItemActive(item, name)).toBe(true)
  })

  it.each(['other', null, undefined])('is false for %s', (name) => {
    expect(isNavItemActive(item, name)).toBe(false)
  })

  it('is false for a symbol route name', () => {
    expect(isNavItemActive(item, Symbol('own'))).toBe(false)
  })

  it('is false for a path target without a name', () => {
    expect(isNavItemActive({ ...item, to: '/x' }, 'own')).toBe(false)
  })
})
