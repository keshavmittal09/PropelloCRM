'use client'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { useAnalyticsSummary, useTodayTasks, useNotifications, useCompleteTask, useSourceStats } from '@/hooks/useQueries'
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/utils'
import Sidebar from '@/components/shared/Sidebar'
import LeadSourceChart from '@/components/shared/LeadSourceChart'
import { notificationsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

function StatCard({ label, value, sub, color = 'text-gray-900' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="crm-surface crm-card-hover rounded-3xl p-6">
      <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-1">{label}</p>
      <p className={`text-4xl font-semibold tracking-tight ${color}`}>{value}</p>
      {sub && <p className="text-[11px] font-medium text-[#9d9185] mt-2 tracking-[0.12em]">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { agent } = useAuthStore()
  const router = useRouter()
  const qc = useQueryClient()
  const { data: summary } = useAnalyticsSummary()
  const { data: tasks } = useTodayTasks()
  const { data: notifications } = useNotifications()
  const { mutateAsync: complete } = useCompleteTask()
  const { data: sourceStats } = useSourceStats()

  const markAllRead = async () => {
    await notificationsApi.readAll()
    qc.invalidateQueries({ queryKey: ['notifications'] })
    toast.success('All notifications marked as read')
  }

  const unread = notifications?.filter(n => !n.is_read) ?? []

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto crm-page-enter">
        {/* Header */}
        <div className="mb-10 mt-4 px-2">
          <h2 className="text-5xl font-semibold tracking-tight text-[#1f1914]">Good morning, {agent?.name?.split(' ')[0]}.</h2>
          <p className="text-[#756c63] font-medium tracking-wide text-sm mt-2">Here is your live real estate pipeline overview.</p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5 mb-10">
          <StatCard label="Total leads" value={summary?.total_leads ?? '—'} />
          <StatCard label="New today" value={summary?.new_leads_today ?? '—'} />
          <StatCard label="Hot leads" value={summary?.hot_leads ?? '—'} />
          <StatCard label="Won (30d)" value={summary?.won_this_month ?? '—'} />
          <StatCard label="Lost (30d)" value={summary?.lost_this_month ?? '—'} color="text-gray-400" />
          <StatCard label="Pipeline value" value={formatCurrency(summary?.pipeline_value ?? 0)} sub="ACTIVE LEADS" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's tasks */}
          <div className="crm-surface rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#2a231d]">Today's tasks</h3>
              <button onClick={() => router.push('/tasks')} className="text-xs text-[#a65630] hover:text-[#894827] transition-colors">View all</button>
            </div>
            {!tasks?.length ? (
              <div className="text-center py-8">
                <p className="text-[#8f8378] text-sm">No tasks due today</p>
                <p className="text-[#afa499] text-xs mt-1">Great job staying on top of things.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map(t => (
                  <div key={t.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${t.status === 'overdue' ? 'border-red-200 bg-red-50/50' : 'border-[#eadfce] bg-[#fffdf9] hover:border-[#dcc9b3]'}`}>
                    <button onClick={() => complete(t.id).then(() => toast.success('Task done!'))}
                      className="w-5 h-5 rounded border-2 border-[#c6b9aa] hover:border-emerald-500 flex-shrink-0 mt-0.5 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${t.status === 'overdue' ? 'text-red-700' : 'text-[#2d261f]'}`}>{t.title}</p>
                      {t.lead && (
                        <button onClick={() => router.push(`/leads/${t.lead_id}`)} className="text-xs text-[#a65630] hover:underline mt-0.5">
                          {t.lead.contact?.name}
                        </button>
                      )}
                      {t.due_at && <p className="text-xs text-[#8f8378]">{formatDateTime(t.due_at)}</p>}
                    </div>
                    {t.priority === 'high' && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium flex-shrink-0">High</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notifications */}
          <div className="crm-surface rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[#2a231d]">Notifications</h3>
                {unread.length > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{unread.length}</span>
                )}
              </div>
              {unread.length > 0 && (
                <button onClick={markAllRead} className="text-xs text-[#a65630] hover:text-[#894827] transition-colors">Mark all read</button>
              )}
            </div>
            {!notifications?.length ? (
              <p className="text-sm text-[#8f8378] text-center py-8">No notifications</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {notifications.slice(0, 10).map(n => (
                  <div key={n.id}
                    className={`p-3 rounded-xl cursor-pointer transition-all ${!n.is_read ? 'bg-[#f7ede5] border border-[#efd7c6]' : 'bg-[#faf7f2] border border-transparent'}`}
                    onClick={() => n.link && router.push(n.link)}>
                    <p className={`text-sm ${!n.is_read ? 'font-semibold text-[#6c3b21]' : 'text-[#554c44]'}`}>{n.title}</p>
                    {n.body && <p className="text-xs text-[#84786c] mt-0.5 line-clamp-1">{n.body}</p>}
                    <p className="text-xs text-[#a29587] mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Lead Source Chart */}
        <div className="mt-6">
          <LeadSourceChart data={sourceStats ?? []} />
        </div>

        {/* Quick actions */}
        <div className="mt-8 flex gap-4 flex-wrap px-2">
          <button onClick={() => router.push('/leads/board')} className="px-6 py-3 bg-[#be6a3f] hover:bg-[#a95d36] text-white rounded-full text-sm font-semibold transition-all shadow-[0_14px_24px_-16px_rgba(169,93,54,0.75)]">
            Open Pipeline Board
          </button>
          <button onClick={() => router.push('/leads?lead_score=hot')} className="px-6 py-3 bg-[#fffaf5] text-[#2d261f] border border-[#e7d5c0] rounded-full text-sm font-semibold hover:border-[#d7bea4] transition-all shadow-sm">
            View Hot Leads
          </button>
          <button onClick={() => router.push('/analytics')} className="px-6 py-3 bg-[#fffaf5] text-[#2d261f] border border-[#e7d5c0] rounded-full text-sm font-semibold hover:border-[#d7bea4] transition-all shadow-sm">
            Analytics
          </button>
        </div>
      </main>
    </div>
  )
}
