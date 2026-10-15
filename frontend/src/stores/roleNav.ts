import type { UserRole } from '../types/auth.ts'

export type RoleNavItem = {
  to: string
  label: string
}

export const TICKET_QUEUE_ROLES: readonly UserRole[] = [
  'after_sales_specialist',
  'senior_after_sales',
  'supervisor',
  'after_sales_supervisor',
  'cs_lead',
  'logistics_after_sales',
  'cs_supervisor',
]

const PAGE_NAME: Record<string, string> = {
  '/employee': '员工端',
  '/agent': '客服端',
  '/knowledge': '知识库',
  '/tickets': '工单列表',
  '/templates': '模板',
}

export function homePathForRole(role: UserRole): string {
  if (role === 'employee') return '/employee'
  if (role === 'frontline_agent') return '/agent'
  if (role === 'admin') return '/knowledge'
  return '/tickets'
}

export function navItemsForRole(role: UserRole): readonly RoleNavItem[] {
  if (role === 'employee') return [{ to: '/employee', label: '员工端' }]
  if (role === 'frontline_agent') return [{ to: '/agent', label: '客服端' }]
  if (role === 'admin') {
    return [
      { to: '/knowledge', label: '知识库' },
      { to: '/tickets', label: '工单列表' },
      { to: '/templates', label: '模板' },
    ]
  }
  return [{ to: '/tickets', label: '工单列表' }]
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  return navItemsForRole(role).some((item) => item.to === pathname)
}

export function pageNameForPath(pathname: string): string {
  return PAGE_NAME[pathname] ?? ''
}

export function allowedRolesForPath(pathname: string): UserRole[] {
  if (pathname === '/employee') return ['employee']
  if (pathname === '/agent') return ['frontline_agent']
  if (pathname === '/knowledge' || pathname === '/templates') return ['admin']
  if (pathname === '/tickets') return ['admin', ...TICKET_QUEUE_ROLES]
  return []
}
