'use client'
import { create } from 'zustand'
import type { Agent } from '@/lib/types'

interface AuthStore {
  agent: Agent | null
  token: string | null
  setAuth: (agent: Agent, token: string) => void
  logout: () => void
  isAdmin: () => boolean
  isManager: () => boolean
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  agent: typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('propello_agent') || 'null')
    : null,
  token: typeof window !== 'undefined'
    ? localStorage.getItem('propello_token')
    : null,

  setAuth: (agent, token) => {
    localStorage.setItem('propello_token', token)
    localStorage.setItem('propello_agent', JSON.stringify(agent))
    set({ agent, token })
  },

  logout: () => {
    localStorage.removeItem('propello_token')
    localStorage.removeItem('propello_agent')
    set({ agent: null, token: null })
    window.location.href = '/login'
  },

  isAdmin: () => get().agent?.role === 'admin',
  isManager: () => ['admin', 'manager'].includes(get().agent?.role || ''),
}))
