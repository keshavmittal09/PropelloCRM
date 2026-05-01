'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { useNotifications } from '@/hooks/useQueries'
import { cn } from '@/lib/cn'

const tabs = [
  { href: '/tasks', label: 'Tasks', icon: '📋' },
  { href: '/call-agent/my-leads', label: 'My Leads', icon: '👥' },
  { href: '/call-agent/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/call-agent/me', label: 'Me', icon: '👤' },
]

export default function MobileBottomNav() {
  const pathname = usePathname()
  const { agent } = useAuthStore()
  const { data: notifications } = useNotifications()

  if (agent?.role !== 'call_agent') return null

  const unreadCount = (notifications ?? []).filter(n => !n.is_read).length

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#e8ddcf] flex safe-area-pb">
      {tabs.map(tab => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
        const showBadge = tab.href === '/alerts' && unreadCount > 0

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors text-xs font-medium border-t-2',
              isActive
                ? 'border-[#c86f43] text-[#c86f43] bg-[#fefaf6]'
                : 'border-transparent text-[#8f8378] hover:text-[#4f453b]',
            )}
          >
            <span className="text-xl relative">
              {tab.icon}
              {showBadge && (
                <span className="absolute -top-1 -right-2 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
