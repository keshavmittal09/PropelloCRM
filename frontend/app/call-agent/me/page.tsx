'use client'
import { useAuthStore } from '@/store/useAuthStore'
import { useMyPerformance } from '@/hooks/useQueries'
import { MobileHeader } from '@/components/mobile/MobileHeader'

export default function MobileMePage() {
  const { agent } = useAuthStore()
  const { data: perf, isLoading } = useMyPerformance()

  return (
    <div className="min-h-screen bg-[#f8f4ef] pb-20">
      <MobileHeader title="Me" showBack={false} />
      <div className="bg-white border-b border-[#e8ddcf] px-4 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#e7cdb9] to-[#f2e3d6] flex items-center justify-center border-2 border-[#d9bca4] text-[#5a3c2b] font-bold text-xl">
            {agent?.name?.charAt(0) ?? '?'}
          </div>
          <div>
            <p className="font-semibold text-[#1f1914] text-lg">{agent?.name}</p>
            <p className="text-sm text-[#8f8378] capitalize">{agent?.role?.replace('_', ' ')}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-3 pt-4">
        <p className="text-xs font-semibold text-[#8f8378] uppercase tracking-wider mb-3 px-1">Last 30 days</p>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'Tasks Done', value: perf?.tasks_completed_30d ?? '—', emoji: '✅' },
            { label: 'Leads Converted', value: perf?.leads_converted_30d ?? '—', emoji: '🎯' },
            { label: 'Connection Rate', value: perf ? `${Math.round(perf.completion_rate * 100)}%` : '—', emoji: '📞' },
            { label: 'Star Rating', value: perf?.star_rating ? '⭐'.repeat(perf.star_rating) : '—', emoji: '⭐' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-2xl border border-[#e8ddcf] p-4 text-center">
              <p className="text-2xl mb-1">{stat.emoji}</p>
              {isLoading ? (
                <div className="h-6 w-12 mx-auto bg-[#f0ebe5] rounded animate-pulse" />
              ) : (
                <p className="font-bold text-[#1f1914] text-lg">{stat.value}</p>
              )}
              <p className="text-xs text-[#8f8378] mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
