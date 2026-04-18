'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { NotificationBell } from './NotificationBell'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/cn'

const nav = [
  { href: '/',           label: 'Dashboard',   icon: '▦' },
  { href: '/leads/board',label: 'Pipeline',    icon: '⬛' },
  { href: '/leads',      label: 'All Leads',   icon: '☰' },
  { href: '/campaigns',  label: 'Campaigns',   icon: '📣' },
  { href: '/campaigns/dashboard', label: 'Campaign Dashboard', icon: '📈' },
  { href: '/leads/nurture',label: 'Re-engagement', icon: '♻️' },
  { href: '/contacts',   label: 'Contacts',    icon: '👥' },
  { href: '/projects',   label: 'Projects',    icon: '🏗️' },
  { href: '/properties', label: 'Properties',  icon: '🏠' },
  { href: '/tasks',      label: 'Tasks',       icon: '✓' },
  { href: '/visits',     label: 'Site Visits', icon: '📅' },
  { href: '/analytics',  label: 'Analytics',   icon: '📊' },
  { href: '/staff',      label: 'Staff & Agents', icon: '🧑‍💼', roles: ['admin', 'manager'] as const },
  { href: '/settings',   label: 'Settings',    icon: '⚙️' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { agent, logout } = useAuthStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleNav = nav.filter(item => {
    if (!('roles' in item) || !item.roles) return true
    return !!agent?.role && item.roles.includes(agent.role as 'admin' | 'manager')
  })

  return (
    <aside className="w-[276px] min-h-screen bg-[linear-gradient(180deg,#171412_0%,#12100f_52%,#0f0d0c_100%)] border-r border-white/5 flex flex-col z-20 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-70">
        <div className="absolute -top-20 -left-20 w-52 h-52 rounded-full bg-[#c86f43]/20 blur-3xl" />
        <div className="absolute bottom-0 -right-24 w-60 h-60 rounded-full bg-[#7c563f]/20 blur-3xl" />
      </div>
      {/* Logo */}
      <div className="px-6 py-8 relative z-10">
        <h1 className="text-[36px] leading-none font-semibold tracking-tight text-[#f4ebe2]">Propello</h1>
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#b8a895] font-semibold mt-2">Real Estate Intelligence</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 py-2 space-y-1 relative z-10">
        {visibleNav.map(item => (
          <Link key={item.href} href={item.href}
            className={cn(
              'flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 border',
              pathname === item.href
                ? 'bg-[#f4e8dd] text-[#2a231e] border-[#f1dac8] shadow-[0_8px_18px_-12px_rgba(0,0,0,0.8)]'
                : 'text-[#b8a895] border-transparent hover:bg-white/5 hover:text-[#f0e5db]'
            )}>
            <span className="text-base opacity-90">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Agent info + logout */}
      <div className="px-4 py-6 mt-auto relative z-10 border-t border-white/5">
        <div className="flex items-center gap-3 px-2 py-2 mb-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#e7cdb9] to-[#f2e3d6] flex items-center justify-center border border-[#d9bca4]/70 text-[#5a3c2b] font-semibold text-sm transition-opacity" style={{ opacity: mounted ? 1 : 0 }}>
            {agent?.name?.charAt(0) ?? '?'}
          </div>
          <div className="flex-1 min-w-0 transition-opacity" style={{ opacity: mounted ? 1 : 0 }}>
            <p className="text-[14px] font-semibold text-[#f2e8de] tracking-tight truncate">{agent?.name}</p>
            <p className="text-[12px] font-medium text-[#a89481] capitalize tracking-wide">{agent?.role}</p>
          </div>
        </div>
        <NotificationBell />
        <button onClick={logout}
          className="w-full mt-1.5 text-xs text-[#a89481] hover:text-[#f4c7ae] text-left px-3 py-1.5 rounded hover:bg-white/5 transition-colors">
          Sign out
        </button>
      </div>
    </aside>
  )
}
