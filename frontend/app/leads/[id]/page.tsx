'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLead, useLeadTimeline, useAllTasks } from '@/hooks/useQueries'
import Sidebar from '@/components/shared/Sidebar'
import { LeadTimeline, AddNoteBox, QuickCallLog, WhatsAppSender, PropertyMatchPanel, TaskList } from '@/components/leads/LeadComponents'
import { ScheduleVisitModal } from '@/components/leads/ScheduleVisitModal'
import { EditLeadModal } from '@/components/leads/EditLeadModal'
import { ScoreBadge, SourceTag, DaysInStage } from '@/components/shared/Badges'
import { DuplicateAlert } from '@/components/shared/DuplicateAlert'
import { formatBudget, formatDate, stageConfig } from '@/lib/utils'
import { leadsApi, tasksApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { MasterProfileTab } from '@/components/leads/MasterProfileTab'
import { TaskCompletionModal } from '@/components/leads/TaskCompletionModal'
import type { Task } from '@/lib/types'
import { useAuthStore } from '@/store/useAuthStore'

type Panel = 'timeline' | 'tasks' | 'properties' | 'memory' | 'profile'
const STAGE_OPTIONS = ['new', 'contacted', 'site_visit_scheduled', 'site_visit_done', 'negotiation', 'won', 'lost', 'nurture'] as const

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const agent = useAuthStore((s) => s.agent)
  const isAdmin = agent?.role === 'admin'
  const { data: lead, isLoading } = useLead(id)
  const { data: activities } = useLeadTimeline(id)
  const { data: tasks } = useAllTasks({ lead_id: id })
  const [panel, setPanel] = useState<Panel>('timeline')
  const [showCallLog, setShowCallLog] = useState(false)
  const [showWhatsApp, setShowWhatsApp] = useState(false)
  const [showVisitModal, setShowVisitModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showLeadNotifyModal, setShowLeadNotifyModal] = useState(false)
  const [nextStage, setNextStage] = useState(lead?.stage ?? 'new')
  const [lostReason, setLostReason] = useState('')
  const [savingStage, setSavingStage] = useState(false)
  const [followupType, setFollowupType] = useState<'call' | 'email' | 'whatsapp'>('call')
  const [followupDueAt, setFollowupDueAt] = useState('')
  const [followupTitle, setFollowupTitle] = useState('')
  const [creatingFollowup, setCreatingFollowup] = useState(false)
  const [deletingLead, setDeletingLead] = useState(false)
  const [completingTask, setCompletingTask] = useState<Task | null>(null)
  const [updatingPriority, setUpdatingPriority] = useState(false)

  useEffect(() => {
    if (lead) {
      setNextStage(lead.stage)
      if (!followupTitle) {
        setFollowupTitle(`Follow up via ${followupType} with ${lead.contact?.name ?? 'lead'}`)
      }
    }
  }, [lead, followupTitle, followupType])

  const handleStageUpdate = async () => {
    if (!lead || nextStage === lead.stage) return
    if (nextStage === 'lost' && !lostReason.trim()) {
      toast.error('Lost reason is required before marking a lead as lost')
      return
    }
    setSavingStage(true)
    try {
      await leadsApi.updateStage(lead.id, nextStage, nextStage === 'lost' ? lostReason : undefined)
      toast.success(`Lead moved to ${nextStage.replace('_', ' ')}`)
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      qc.invalidateQueries({ queryKey: ['timeline', lead.id] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['kanban'] })
    } catch {
      toast.error('Failed to update stage')
      setNextStage(lead.stage)
    } finally {
      setSavingStage(false)
    }
  }

  const handleCreateFollowup = async () => {
    if (!lead) return
    if (!followupTitle.trim()) return toast.error('Follow-up title is required')
    setCreatingFollowup(true)
    try {
      await tasksApi.create({
        lead_id: lead.id,
        title: followupTitle,
        task_type: followupType,
        due_at: followupDueAt ? `${followupDueAt}:00` : null,
        assigned_to: lead.assigned_to,
        priority: 'normal',
      })
      toast.success('Follow-up scheduled')
      setFollowupDueAt('')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['tasks', { lead_id: lead.id }] })
    } catch {
      toast.error('Failed to schedule follow-up')
    } finally {
      setCreatingFollowup(false)
    }
  }

  const handleDeleteLead = async () => {
    if (!isAdmin) {
      toast.error('Only admin can delete leads')
      return
    }
    if (!lead) return
    if (!confirm(`Delete lead ${lead.contact?.name ?? lead.id}? This cannot be undone.`)) return
    setDeletingLead(true)
    try {
      await leadsApi.delete(lead.id)
      toast.success('Lead deleted')
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['kanban'] })
      router.push('/leads')
    } catch {
      toast.error('Failed to delete lead')
    } finally {
      setDeletingLead(false)
    }
  }

  const handlePriorityChange = async (newPriority: string) => {
    if (!lead) return
    setUpdatingPriority(true)
    try {
      await leadsApi.updateLeadPriority(lead.id, newPriority)
      toast.success(`Priority updated to ${newPriority}`)
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to update priority')
    } finally {
      setUpdatingPriority(false)
    }
  }

  if (isLoading) return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
      </main>
    </div>
  )

  if (!lead) return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">Lead not found</p>
      </main>
    </div>
  )

  const stageCfg = stageConfig[lead.stage]
  const isDuplicate = activities?.some(a => a.meta?.duplicate === true) || lead.call_count > 1 && lead.source === 'priya_ai'

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto crm-page-enter">
        {/* Top bar */}
        <div className="bg-[#fffaf4] border-b border-[#e8ddcf] px-8 py-5">
          <button onClick={() => router.back()} className="text-sm text-[#7b7166] hover:text-[#5f554b] mb-3 flex items-center gap-1 transition-colors">
            ← Back
          </button>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h2 className="text-5xl font-semibold text-[#1f1914] crm-density-title">{lead.contact?.name}</h2>
                <ScoreBadge score={lead.lead_score} />
                <select
                  value={lead.priority}
                  onChange={(e) => handlePriorityChange(e.target.value)}
                  disabled={updatingPriority}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-[#e1d3c2] bg-white text-[#52473d] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 disabled:opacity-50"
                >
                  <option value="P1">🔥 P1 (Critical)</option>
                  <option value="P2">🟠 P2 (High)</option>
                  <option value="P3">🟡 P3 (Normal)</option>
                  <option value="P4">🔵 P4 (Low)</option>
                  <option value="P5">⚪ P5 (Minimal)</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <p className="text-[#7b7166]">{lead.contact?.phone} {lead.contact?.email && `· ${lead.contact.email}`}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stageCfg.color }} />
                  <span className="font-medium text-[#4f453b]">{stageCfg.label}</span>
                  <span className="text-[#96897c]">·</span>
                  <DaysInStage days={lead.days_in_stage} />
                </span>
                <SourceTag source={lead.source} />
                {lead.assigned_agent && (
                  <span className="text-sm text-[#7b7166]">Agent: {lead.assigned_agent.name}</span>
                )}
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => { setShowCallLog(!showCallLog); setShowWhatsApp(false) }}
                className="px-4 py-2 border border-[#e1d3c2] bg-[#fffdfa] rounded-xl text-sm font-medium hover:bg-[#f8eee3] transition-colors text-[#52473d]">
                📞 Log call
              </button>
              <button onClick={() => { setShowWhatsApp(!showWhatsApp); setShowCallLog(false) }}
                className="px-4 py-2 border border-green-200 bg-green-50 text-green-700 rounded-xl text-sm font-medium hover:bg-green-100 transition-colors">
                💬 WhatsApp
              </button>
              <button onClick={() => setShowVisitModal(true)}
                className="px-4 py-2 border border-[#e1d3c2] bg-[#fffdfa] rounded-xl text-sm font-medium hover:bg-[#f8eee3] transition-colors text-[#52473d]">
                🏠 Schedule visit
              </button>
              <button onClick={() => setShowLeadNotifyModal(true)}
                className="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors">
                🔔 Notify lead
              </button>
              {isAdmin && (
                <button
                  onClick={handleDeleteLead}
                  disabled={deletingLead}
                  className="px-4 py-2 border border-red-200 text-red-700 bg-red-50 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {deletingLead ? 'Deleting...' : 'Delete lead'}
                </button>
              )}
            </div>
          </div>
        </div>

        <DuplicateAlert isDuplicate={!!isDuplicate} />

        <div className="p-8 grid grid-cols-1 xl:grid-cols-3 gap-6 crm-stagger">
          {/* Left: lead info */}
          <div className="xl:col-span-1 space-y-4">
            {/* Quick action panels */}
            {showCallLog && <QuickCallLog leadId={id} onClose={() => setShowCallLog(false)} />}
            {showWhatsApp && <WhatsAppSender leadId={id} onClose={() => setShowWhatsApp(false)} />}
            {showVisitModal && <ScheduleVisitModal leadId={id} onClose={() => setShowVisitModal(false)} />}
            {showEditModal && <EditLeadModal lead={lead} onClose={() => setShowEditModal(false)} />}
            {showLeadNotifyModal && (
              <LeadNotifyModal
                leadId={id}
                leadName={lead.contact?.name ?? 'Lead'}
                onClose={() => setShowLeadNotifyModal(false)}
                onDone={() => {
                  setShowLeadNotifyModal(false)
                  qc.invalidateQueries({ queryKey: ['timeline', id] })
                }}
              />
            )}

            {/* Lead details card */}
            <div className="crm-surface rounded-2xl p-5 space-y-3 crm-density-tight">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-[#2b241e] text-sm">Lead details</h3>
                <button onClick={() => setShowEditModal(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  ✏️ Edit
                </button>
              </div>
              <DetailRow label="Budget" value={formatBudget(lead.budget_min, lead.budget_max)} />
              <DetailRow label="Property type" value={lead.property_type_interest ?? '—'} />
              <DetailRow label="Location" value={lead.location_preference ?? '—'} />
              <DetailRow label="Timeline" value={lead.timeline?.replace('_', ' ') ?? '—'} />
              <DetailRow label="Calls" value={`${lead.call_count} call(s)`} />
              <DetailRow label="Created" value={formatDate(lead.created_at)} />
              {lead.lost_reason && <DetailRow label="Lost reason" value={lead.lost_reason} className="text-red-600" />}
            </div>

            <div className="crm-surface rounded-2xl p-5 space-y-3 crm-density-tight">
              <h3 className="font-semibold text-[#2b241e] text-sm">Pipeline stage</h3>
              <select
                value={nextStage}
                onChange={(e) => setNextStage(e.target.value as typeof STAGE_OPTIONS[number])}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
              >
                {STAGE_OPTIONS.map((stage) => (
                  <option key={stage} value={stage}>{stage.replace('_', ' ')}</option>
                ))}
              </select>
              {nextStage === 'lost' && (
                <input
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Reason for losing this lead"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
              )}
              <button
                onClick={handleStageUpdate}
                disabled={savingStage || nextStage === lead.stage}
                className="w-full px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {savingStage ? 'Updating...' : 'Update stage'}
              </button>
            </div>

            <div className="crm-surface rounded-2xl p-5 space-y-3 crm-density-tight">
              <h3 className="font-semibold text-[#2b241e] text-sm">Schedule follow-up</h3>
              <input
                value={followupTitle}
                onChange={(e) => setFollowupTitle(e.target.value)}
                placeholder="Follow-up title"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={followupType}
                  onChange={(e) => {
                    const value = e.target.value as 'call' | 'email' | 'whatsapp'
                    setFollowupType(value)
                    if (!followupTitle.trim()) {
                      setFollowupTitle(`Follow up via ${value} with ${lead.contact?.name ?? 'lead'}`)
                    }
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
                >
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <input
                  type="datetime-local"
                  value={followupDueAt}
                  onChange={(e) => setFollowupDueAt(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
              </div>
              <button
                onClick={handleCreateFollowup}
                disabled={creatingFollowup}
                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {creatingFollowup ? 'Scheduling...' : 'Schedule follow-up'}
              </button>
            </div>

            {/* Personal notes */}
            {lead.contact?.personal_notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 crm-density-tight">
                <p className="text-xs font-semibold text-amber-700 mb-1.5">Personal notes</p>
                <p className="text-sm text-amber-800">{lead.contact.personal_notes}</p>
              </div>
            )}

            {/* Add note */}
            <AddNoteBox leadId={id} />
          </div>

          {/* Right: tabbed panels */}
          <div className="xl:col-span-2">
            {/* Tabs */}
            <div className="flex gap-1 mb-4 bg-[#f3e9dd] p-1 rounded-xl w-fit border border-[#e7dac9]">
              {(['timeline', 'tasks', 'properties', 'profile', 'memory'] as Panel[]).map(p => (
                <button key={p} onClick={() => setPanel(p)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${panel === p ? 'bg-white text-[#2b241e] shadow-sm' : 'text-[#7b7166] hover:text-[#4f453b]'}`}>
                  {p === 'timeline' ? 'Timeline' : p === 'tasks' ? 'Tasks' : p === 'properties' ? 'Matching listings' : p === 'profile' ? 'Master Profile' : 'Priya memory'}
                </button>
              ))}
            </div>

            <div className="crm-surface rounded-2xl p-5 min-h-[400px] crm-density-tight">
              {panel === 'timeline' && <LeadTimeline activities={activities ?? []} />}
              {panel === 'tasks' && <TaskList tasks={tasks ?? []} onCompleteTask={(task) => setCompletingTask(task)} />}
              {panel === 'properties' && <PropertyMatchPanel leadId={id} />}
              {panel === 'profile' && <MasterProfileTab leadId={id} />}
              {panel === 'memory' && (
                <div>
                  <p className="text-xs font-semibold text-purple-700 mb-3">Priya AI memory brief</p>
                  {lead.priya_memory_brief ? (
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded-xl text-xs leading-relaxed">
                      {lead.priya_memory_brief}
                    </pre>
                  ) : (
                    <p className="text-sm text-gray-400">No memory brief yet — will be generated after first Priya call.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Task Completion Modal */}
        {completingTask && (
          <TaskCompletionModal
            task={completingTask}
            lead={lead}
            onClose={() => setCompletingTask(null)}
            onComplete={() => {
              setCompletingTask(null)
              qc.invalidateQueries({ queryKey: ['tasks'] })
              qc.invalidateQueries({ queryKey: ['timeline', id] })
              qc.invalidateQueries({ queryKey: ['lead', id] })
            }}
          />
        )}
      </main>
    </div>
  )
}

function DetailRow({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm text-[#887c6f] flex-shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right ${className || 'text-[#2b241e]'}`}>{value}</span>
    </div>
  )
}


function LeadNotifyModal({
  leadId,
  leadName,
  onClose,
  onDone,
}: {
  leadId: string
  leadName: string
  onClose: () => void
  onDone: () => void
}) {
  const [message, setMessage] = useState('')
  const [subject, setSubject] = useState('')
  const [scheduleMode, setScheduleMode] = useState<'send_now' | 'schedule'>('send_now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const channels = [
      ...(sendWhatsApp ? ['whatsapp'] : []),
      ...(sendEmail ? ['email'] : []),
    ] as Array<'whatsapp' | 'email'>

    if (!channels.length) {
      toast.error('Select at least one channel')
      return
    }
    if (!message.trim()) {
      toast.error('Message is required')
      return
    }
    if (scheduleMode === 'schedule' && !scheduledAt) {
      toast.error('Select schedule date and time')
      return
    }

    setSubmitting(true)
    try {
      await leadsApi.notify(leadId, {
        channels,
        message: message.trim(),
        subject: subject.trim() || null,
        scheduled_at: scheduleMode === 'schedule' ? `${scheduledAt}:00` : null,
      })
      toast.success(scheduleMode === 'schedule' ? 'Lead notification scheduled' : 'Lead notification sent')
      onDone()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to notify lead')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-[#eadfce] p-6 max-h-[90vh] overflow-auto">
        <h3 className="text-xl font-semibold text-[#2b241e]">Notify {leadName}</h3>
        <p className="text-sm text-[#7b7166] mt-1">Send now or schedule WhatsApp/email notification.</p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-[#4f453b]">
              <input type="checkbox" checked={sendWhatsApp} onChange={(e) => setSendWhatsApp(e.target.checked)} />
              WhatsApp
            </label>
            <label className="flex items-center gap-2 text-sm text-[#4f453b]">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Email
            </label>
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="w-full px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm"
          />

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Write your custom notification text..."
            className="w-full px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={scheduleMode}
              onChange={(e) => setScheduleMode(e.target.value as 'send_now' | 'schedule')}
              className="px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm bg-white"
            >
              <option value="send_now">Send now</option>
              <option value="schedule">Schedule</option>
            </select>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={scheduleMode !== 'schedule'}
              className="px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-full border border-[#e5d7c5] text-[#6e6357]">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 px-4 py-2 rounded-full bg-[#2f2317] text-white font-semibold disabled:opacity-50"
          >
            {submitting ? 'Processing...' : scheduleMode === 'schedule' ? 'Schedule notification' : 'Send notification'}
          </button>
        </div>
      </div>
    </div>
  )
}
