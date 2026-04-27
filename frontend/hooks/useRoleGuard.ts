/**
 * Role-based access control hooks and components
 */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'

export type Role = 'admin' | 'manager' | 'agent' | 'call_agent'

const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 4,
  manager: 3,
  agent: 2,
  call_agent: 1,
}

/**
 * Check if user has required role or higher
 */
export function hasRole(userRole: Role | undefined, requiredRole: Role): boolean {
  if (!userRole) return false
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

/**
 * Check if user can access a feature based on role
 */
export function canAccessFeature(userRole: Role | undefined, feature: string): boolean {
  if (!userRole) return false

  const featureAccess: Record<string, Role[]> = {
    // Admin only
    'billing': ['admin'],
    'integrations': ['admin'],
    'settings_full': ['admin'],

    // Admin + Manager
    'analytics': ['admin', 'manager'],
    'leaderboard': ['admin', 'manager'],
    'staff_management': ['admin', 'manager'],
    'lead_assignment': ['admin', 'manager'],
    'auto_assign': ['admin', 'manager'],
    'agent_rating': ['admin', 'manager'],
    'campaign_management': ['admin', 'manager'],

    // All authenticated users
    'leads': ['admin', 'manager', 'agent', 'call_agent'],
    'tasks': ['admin', 'manager', 'agent', 'call_agent'],
    'campaigns': ['admin', 'manager'],
  }

  const allowedRoles = featureAccess[feature] || []
  return allowedRoles.includes(userRole)
}

/**
 * Hook to protect routes based on role
 * Redirects to /unauthorized if user doesn't have required role
 */
export function useRoleGuard(requiredRole: Role) {
  const { agent } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!agent) {
      router.push('/login')
      return
    }

    if (!hasRole(agent.role as Role, requiredRole)) {
      router.push('/unauthorized')
    }
  }, [agent, requiredRole, router])

  return {
    hasAccess: hasRole(agent?.role as Role, requiredRole),
    user: agent,
  }
}

/**
 * Hook to check if user can view other agents' data
 */
export function useCanViewOtherAgents() {
  const { agent } = useAuthStore()
  if (!agent) return false
  return agent.role === 'admin' || agent.role === 'manager'
}

/**
 * Hook to check if user is call_agent (most restricted role)
 */
export function useIsCallAgent() {
  const { agent } = useAuthStore()
  return agent?.role === 'call_agent'
}

/**
 * Get user's own API endpoints
 */
export function getScopedEndpoints() {
  return {
    tasks: '/api/me/tasks',
    leads: '/api/me/leads',
    performance: '/api/me/performance',
  }
}
