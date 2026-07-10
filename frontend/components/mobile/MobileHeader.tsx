'use client'
import { useRouter } from 'next/navigation'
import { ReactNode, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useAuthStore } from '@/store/useAuthStore'

interface Props {
  title: string
  subtitle?: string
  showBack?: boolean
  rightElement?: ReactNode
  onBack?: () => void
}

export function MobileHeader({ title, subtitle, showBack = true, rightElement, onBack }: Props) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const { agent, logout } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)

  // Sales agents get a menu to reach their Dashboard / Tasks and to sign out —
  // and their header shows on desktop too (not just phone widths).
  const showMenu = agent?.role === 'call_agent' || agent?.role === 'agent'

  if (!isMobile && !showMenu) return null

  const go = (href: string) => { setMenuOpen(false); router.push(href) }

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-[#e8ddcf] px-4 pt-4 pb-3">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={onBack ?? (() => router.back())}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7b7166] hover:bg-[#f0e8de] transition-colors flex-shrink-0"
          >
            ←
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-[#1f1914] truncate">{title}</h1>
          {subtitle && <p className="text-xs text-[#8f8378] truncate">{subtitle}</p>}
        </div>
        {rightElement && <div className="flex-shrink-0">{rightElement}</div>}
        {showMenu && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Menu"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[#4f453b] bg-[#f5f0e8] hover:bg-[#eadfce] transition-colors text-lg"
            >
              ☰
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-50 w-48 bg-white border border-[#e8ddcf] rounded-2xl shadow-xl py-1.5 overflow-hidden">
                  {agent?.name && (
                    <div className="px-4 py-2 border-b border-[#f0e8de]">
                      <p className="text-sm font-semibold text-[#2b241e] truncate">{agent.name}</p>
                      <p className="text-[11px] text-[#a29587] capitalize">{agent.role}</p>
                    </div>
                  )}
                  <button onClick={() => go('/')}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-[#2b241e] hover:bg-[#faf5ee] flex items-center gap-2.5">
                    <span>📊</span> Dashboard
                  </button>
                  <button onClick={() => go('/call-agent/tasks')}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-[#2b241e] hover:bg-[#faf5ee] flex items-center gap-2.5">
                    <span>📋</span> Tasks
                  </button>
                  <button onClick={() => { setMenuOpen(false); logout() }}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-[#f0e8de]">
                    <span>🚪</span> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
