'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { useAnalyticsSummary, useTodayTasks, useNotifications, useSourceStats } from '@/hooks/useQueries'
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/utils'
import Sidebar from '@/components/shared/Sidebar'
import LeadSourceChart from '@/components/shared/LeadSourceChart'
import { UnifiedTaskCompletionSheet } from '@/components/tasks/UnifiedTaskCompletionSheet'
import TalkToAIModal from '@/components/shared/TalkToAIModal'
import { authApi, notificationsApi } from '@/lib/api'
import { MobileHeader } from '@/components/mobile/MobileHeader'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Agent, Task } from '@/lib/types'

function StatCard({ label, value, sub, color = 'text-gray-900', onClick }: { label: string; value: string | number; sub?: string; color?: string; onClick?: () => void }) {
  return (
    <div
      className={`crm-surface crm-card-hover rounded-3xl p-6 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
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
  const { data: sourceStats } = useSourceStats()
  const dashboardTasks = (tasks ?? []).slice(0, 12)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [showAICall, setShowAICall] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [completingTask, setCompletingTask] = useState<Task | null>(null)

  useEffect(() => {
    if (agent?.role !== 'admin') return
    authApi.listAgents().then(setAgents).catch(() => setAgents([]))
  }, [agent?.role])

  const markAllRead = async () => {
    await notificationsApi.readAll()
    qc.invalidateQueries({ queryKey: ['notifications'] })
    toast.success('All notifications marked as read')
  }

  const unread = notifications?.filter(n => !n.is_read) ?? []

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto crm-page-enter">
        <MobileHeader
          title="Dashboard"
          subtitle={summary ? `${summary.total_leads} total leads` : 'Loading...'}
        />
        {/* Header */}
        <div className="mb-10 mt-4 px-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-5xl font-semibold tracking-tight text-[#1f1914]">Good morning, {agent?.name?.split(' ')[0]}.</h2>
            <p className="text-[#756c63] font-medium tracking-wide text-sm mt-2">Here is your live real estate pipeline overview.</p>
          </div>
          <button
            onClick={() => setShowAICall(true)}
            className="mt-2 rounded-full bg-gradient-to-r from-pink-500 to-indigo-500 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-lg transition-opacity hover:opacity-95"
          >
            📞 Talk to AI
          </button>
        </div>

        {/* Primary Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
          <StatCard label="Total Leads" value={summary?.total_leads ?? '—'}
            onClick={() => router.push('/leads')} />
          <StatCard label="New Today" value={summary?.new_leads_today ?? '—'}
            onClick={() => router.push('/leads?date_filter=today')} />
          <div
            className="crm-surface crm-card-hover rounded-3xl p-6 cursor-pointer hover:shadow-md transition-shadow col-span-2"
            onClick={() => router.push('/leads?stage=won')}
          >
            <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-3">Converted (30d)</p>
            <div className="flex items-end gap-6">
              <div>
                <p className="text-4xl font-semibold tracking-tight text-emerald-600">{summary?.converted_leads ?? '—'}</p>
                <p className="text-[11px] font-medium text-[#9d9185] mt-2 tracking-[0.12em]">TOTAL CONVERTED</p>
              </div>
              <div className="border-l border-[#e8ddd4] pl-6">
                <p className="text-4xl font-semibold tracking-tight text-indigo-600">{summary?.conversion_rate ?? 0}%</p>
                <p className="text-[11px] font-medium text-[#9d9185] mt-2 tracking-[0.12em]">30-DAY RATE</p>
              </div>
            </div>
          </div>
        </div>

        {/* Lead Category Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
          <div className="rounded-3xl p-5 bg-red-50 border border-red-100 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/leads?lead_score=hot')}>
            <p className="text-[11px] tracking-[0.16em] text-red-500 font-semibold uppercase mb-1">Hot Leads</p>
            <p className="text-4xl font-semibold tracking-tight text-red-600">{summary?.hot_leads ?? '—'}</p>
            <p className="text-[11px] font-medium text-red-400 mt-2 tracking-[0.12em]">SCORE 80–100</p>
          </div>
          <div className="rounded-3xl p-5 bg-yellow-50 border border-yellow-100 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/leads?lead_score=warm')}>
            <p className="text-[11px] tracking-[0.16em] text-yellow-600 font-semibold uppercase mb-1">Warm Leads</p>
            <p className="text-4xl font-semibold tracking-tight text-yellow-700">{summary?.warm_leads ?? '—'}</p>
            <p className="text-[11px] font-medium text-yellow-500 mt-2 tracking-[0.12em]">SCORE 50–79</p>
          </div>
          <div className="rounded-3xl p-5 bg-blue-50 border border-blue-100 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/leads?lead_score=cold')}>
            <p className="text-[11px] tracking-[0.16em] text-blue-500 font-semibold uppercase mb-1">Cold Leads</p>
            <p className="text-4xl font-semibold tracking-tight text-blue-600">{summary?.cold_leads ?? '—'}</p>
            <p className="text-[11px] font-medium text-blue-400 mt-2 tracking-[0.12em]">SCORE 0–49</p>
          </div>
          <div className="rounded-3xl p-5 bg-gray-50 border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push('/leads?assigned=assigned')}>
            <p className="text-[11px] tracking-[0.16em] text-gray-500 font-semibold uppercase mb-1">Assigned</p>
            <p className="text-4xl font-semibold tracking-tight text-gray-700">{summary?.assigned_leads ?? '—'}</p>
            <p className="text-[11px] font-medium text-gray-400 mt-2 tracking-[0.12em]">ACTIVE LEADS</p>
          </div>
        </div>

        {/* AI & WhatsApp Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          <StatCard label="AI Calls (30d)" value={summary?.ai_calls_completed ?? '—'} sub="PRIYA + CAMPAIGN" color="text-violet-600" />
          <StatCard label="WhatsApp Sent (30d)" value={summary?.whatsapp_sent ?? '—'} sub="AUTO + MANUAL" color="text-green-600" />
          <StatCard label="Won (30d)" value={summary?.won_this_month ?? '—'} color="text-emerald-700"
            onClick={() => router.push('/leads?stage=won')} />
          <StatCard label="Lost (30d)" value={summary?.lost_this_month ?? '—'} color="text-gray-400"
            onClick={() => router.push('/leads?stage=lost')} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's tasks */}
          <div className="crm-surface rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#2a231d]">Today&apos;s tasks</h3>
              <button onClick={() => router.push('/tasks')} className="text-xs text-[#a65630] hover:text-[#894827] transition-colors">View all</button>
            </div>
            {!tasks?.length ? (
              <div className="text-center py-8">
                <p className="text-[#8f8378] text-sm">No tasks due today</p>
                <p className="text-[#afa499] text-xs mt-1">Great job staying on top of things.</p>
              </div>
            ) : (
              <>
                {tasks.length > dashboardTasks.length && (
                  <p className="text-xs text-[#8f8378] mb-2">
                    Showing {dashboardTasks.length} of {tasks.length} tasks.
                  </p>
                )}
                <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
                  {dashboardTasks.map(t => (
                  <div key={t.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${t.status === 'overdue' ? 'border-red-200 bg-red-50/50' : 'border-[#eadfce] bg-[#fffdf9] hover:border-[#dcc9b3]'}`}>
                    <button onClick={() => setCompletingTask(t)}
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
              </>
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
          <button onClick={() => router.push('/leads?lead_score=cold&retry=retry_1')} className="px-6 py-3 bg-[#fffaf5] text-[#2d261f] border border-[#e7d5c0] rounded-full text-sm font-semibold hover:border-[#d7bea4] transition-all shadow-sm">
            Cold Retries
          </button>
          <button onClick={() => router.push('/leads?whatsapp_status=not_sent&lead_score=hot')} className="px-6 py-3 bg-[#fffaf5] text-[#2d261f] border border-[#e7d5c0] rounded-full text-sm font-semibold hover:border-[#d7bea4] transition-all shadow-sm">
            Hot — No WhatsApp
          </button>
          <button onClick={() => router.push('/analytics')} className="px-6 py-3 bg-[#fffaf5] text-[#2d261f] border border-[#e7d5c0] rounded-full text-sm font-semibold hover:border-[#d7bea4] transition-all shadow-sm">
            Analytics
          </button>
          {agent?.role === 'admin' && (
            <button onClick={() => setShowBroadcast(true)} className="px-6 py-3 bg-[#fff4ea] text-[#8f4d2a] border border-[#efcfb3] rounded-full text-sm font-semibold hover:border-[#e2b78f] transition-all shadow-sm">
              Send agent notification
            </button>
          )}
        </div>

        {showBroadcast && agent?.role === 'admin' && (
          <AdminBroadcastModal
            agents={agents}
            onClose={() => setShowBroadcast(false)}
            onDone={() => {
              setShowBroadcast(false)
              qc.invalidateQueries({ queryKey: ['notifications'] })
            }}
          />
        )}

        {/* Task Completion Modal */}
        {completingTask && (
          <UnifiedTaskCompletionSheet
            task={completingTask}
            lead={null}
            onClose={() => setCompletingTask(null)}
            onComplete={() => {
              setCompletingTask(null)
              qc.invalidateQueries({ queryKey: ['tasks'] })
            }}
          />
        )}

        {showAICall && <TalkToAIModal onClose={() => setShowAICall(false)} />}
      </main>
    </div>
  )
}


function AdminBroadcastModal({
  agents,
  onClose,
  onDone,
}: {
  agents: Agent[]
  onClose: () => void
  onDone: () => void
}) {
  const eligibleAgents = agents.filter((a) => a.role !== 'admin')
  const [allAgents, setAllAgents] = useState(true)
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [channelInApp, setChannelInApp] = useState(true)
  const [channelWhatsApp, setChannelWhatsApp] = useState(true)
  const [channelEmail, setChannelEmail] = useState(true)
  const [sending, setSending] = useState(false)

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const submit = async () => {
    const channels = [
      ...(channelInApp ? ['in_app'] : []),
      ...(channelWhatsApp ? ['whatsapp'] : []),
      ...(channelEmail ? ['email'] : []),
    ] as Array<'in_app' | 'whatsapp' | 'email'>

    if (!channels.length) { toast.error('Select at least one channel'); return }
    if (!message.trim()) { toast.error('Message is required'); return }
    if (!allAgents && selectedAgentIds.length === 0) { toast.error('Select at least one agent'); return }

    setSending(true)
    try {
      await notificationsApi.broadcast({
        channels,
        message: message.trim(),
        subject: subject.trim() || null,
        target_agent_ids: allAgents ? [] : selectedAgentIds,
        all_agents: allAgents,
      })
      toast.success('Notification sent to agents')
      onDone()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to send agent notification')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white border border-[#eadfce] rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto shadow-xl">
        <h3 className="text-xl font-semibold text-[#2a231d]">Admin Agent Broadcast</h3>
        <p className="text-sm text-[#7b7166] mt-1">Send a custom in-app/WhatsApp/email message to all or selected agents.</p>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-[#4f453b]">
              <input type="radio" checked={allAgents} onChange={() => setAllAgents(true)} /> All agents
            </label>
            <label className="flex items-center gap-2 text-sm text-[#4f453b]">
              <input type="radio" checked={!allAgents} onChange={() => setAllAgents(false)} /> Selected agents
            </label>
          </div>

          {!allAgents && (
            <div className="border border-[#eadfce] rounded-xl p-3 max-h-44 overflow-y-auto space-y-2">
              {eligibleAgents.map((agent) => (
                <label key={agent.id} className="flex items-center gap-2 text-sm text-[#4f453b]">
                  <input type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
                  {agent.name} ({agent.role})
                </label>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[['In-app', channelInApp, setChannelInApp] as const, ['WhatsApp', channelWhatsApp, setChannelWhatsApp] as const, ['Email', channelEmail, setChannelEmail] as const].map(([label, checked, setChecked]) => (
              <label key={label} className="flex items-center gap-2 text-sm text-[#4f453b]">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {label}
              </label>
            ))}
          </div>

          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" className="w-full px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm" />
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6} placeholder="Write custom notification text..." className="w-full px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm" />
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-full border border-[#e5d7c5] text-[#6e6357]">Cancel</button>
          <button onClick={submit} disabled={sending} className="flex-1 px-4 py-2 rounded-full bg-[#2f2317] text-white font-semibold disabled:opacity-50">
            {sending ? 'Sending...' : 'Send notification'}
          </button>
        </div>
      </div>
    </div>
  )
}
