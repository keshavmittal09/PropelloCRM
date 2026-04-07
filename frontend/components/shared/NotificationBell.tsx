'use client'
import { useEffect, useRef, useState } from 'react'
import { useNotifications } from '@/hooks/useQueries'
import { notificationsApi } from '@/lib/api'
import { timeAgo } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data: notifications } = useNotifications()
  const router = useRouter()
  const qc = useQueryClient()
  const prevLatestIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  
  const unreadCount = notifications?.filter(n => !n.is_read).length ?? 0

  useEffect(() => {
    const latest = notifications?.[0]
    if (!initializedRef.current) {
      prevLatestIdRef.current = latest?.id ?? null
      initializedRef.current = true
      return
    }

    if (latest?.id && latest.id !== prevLatestIdRef.current) {
      toast.success(latest.body ? `${latest.title}: ${latest.body}` : latest.title)
      prevLatestIdRef.current = latest.id
    }
  }, [notifications])

  const markAllRead = async () => {
    await notificationsApi.readAll()
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const handleNotifClick = (link: string | null) => {
    setOpen(false)
    if (link) router.push(link)
  }

  return (
    <div className="relative">
      <button 
        onClick={() => setOpen(!open)}
        className="w-full mt-2 flex items-center justify-between text-xs text-gray-600 hover:text-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-50 transition-colors"
      >
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span className="bg-red-500 text-white min-w-[18px] text-center rounded-full px-1.5 py-0.5 font-bold">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">Recent Updates</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-auto">
            {!notifications?.length ? (
              <p className="text-xs text-gray-400 p-4 text-center">No notifications</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifications.map(n => (
                  <div 
                    key={n.id} 
                    onClick={() => handleNotifClick(n.link)}
                    className={`p-3 cursor-pointer transition-colors ${!n.is_read ? 'bg-indigo-50/30' : 'hover:bg-gray-50'}`}
                  >
                    <p className={`text-xs ${!n.is_read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{n.body}</p>}
                    <span className="text-[10px] text-gray-400 mt-1 block">{timeAgo(n.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
