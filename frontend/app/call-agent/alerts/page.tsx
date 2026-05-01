'use client'
import { useNotifications } from '@/hooks/useQueries'
import { useRouter } from 'next/navigation'
import { MobileHeader } from '@/components/mobile/MobileHeader'

export default function MobileAlertsPage() {
  const { data: notifications, isLoading } = useNotifications()
  const router = useRouter()
  const unread = (notifications ?? []).filter(n => !n.is_read)
  const read = (notifications ?? []).filter(n => n.is_read)

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="min-h-screen bg-[#f8f4ef] pb-20">
      <MobileHeader
        title="Alerts"
        subtitle={unread.length > 0 ? `${unread.length} unread` : 'All caught up'}
        showBack={false}
      />

      <div className="px-3 pt-3 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl h-20 animate-pulse border border-[#e8ddcf]" />
            ))}
          </div>
        ) : (notifications ?? []).length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🔔</p>
            <p className="text-[#8f8378] font-medium">No notifications</p>
          </div>
        ) : (
          <>
            {unread.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#8f8378] uppercase tracking-wider mb-2 px-1">New</p>
                {unread.map(n => (
                  <div
                    key={n.id}
                    onClick={() => n.link && router.push(n.link)}
                    className="bg-[#fef7f2] border border-[#efd7c6] rounded-2xl p-4 mb-2 cursor-pointer active:bg-[#fdf0e6]"
                  >
                    <p className="text-sm font-semibold text-[#2a231d]">{n.title}</p>
                    {n.body && <p className="text-xs text-[#8f8378] mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[11px] text-[#b8a895] mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
            {read.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#8f8378] uppercase tracking-wider mb-2 px-1">Earlier</p>
                {read.map(n => (
                  <div
                    key={n.id}
                    onClick={() => n.link && router.push(n.link)}
                    className="bg-white border border-[#e8ddcf] rounded-2xl p-4 mb-2 cursor-pointer active:bg-[#faf8f5]"
                  >
                    <p className="text-sm font-medium text-[#4f453b]">{n.title}</p>
                    {n.body && <p className="text-xs text-[#8f8378] mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[11px] text-[#b8a895] mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
