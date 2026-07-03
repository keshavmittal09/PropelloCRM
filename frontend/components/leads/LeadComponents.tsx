'use client'
import { useState } from 'react'
import { useAddNote, useLogCall, usePropertyMatches, useCompleteTask } from '@/hooks/useQueries'
import { leadsApi } from '@/lib/api'
import { formatDateTime, activityIcons, formatCurrency, timeAgo } from '@/lib/utils'
import { ScoreBadge, SourceTag } from '@/components/shared/Badges'
import type { Activity, Task, Property } from '@/lib/types'
import toast from 'react-hot-toast'
import { UnifiedTaskCompletionSheet } from '@/components/tasks/UnifiedTaskCompletionSheet'

// ─── LOST REASON MODAL ────────────────────────────────────────────────────────
const LOST_REASONS = ['Budget too low', 'Went to competitor', 'Not responding', 'Not ready yet', 'Location mismatch', 'Other']

export default function LostReasonModal({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-semibold text-gray-900 mb-1">Mark as lost</h3>
        <p className="text-sm text-gray-500 mb-4">Select a reason — this helps improve future lead quality.</p>
        <div className="space-y-2 mb-6">
          {LOST_REASONS.map(r => (
            <button key={r} onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-[14px] border transition-colors ${reason === r ? 'border-gray-900 bg-[#1d1d1f] text-white' : 'border-gray-200/80 bg-[#fbfbfd] hover:border-gray-300 text-[#1d1d1f]'}`}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 border border-gray-200/80 rounded-full text-sm font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-50 transition-all">Cancel</button>
          <button onClick={() => reason && onConfirm(reason)} disabled={!reason}
            className="flex-1 py-3 bg-[#1d1d1f] text-white rounded-full text-sm font-semibold disabled:opacity-50 hover:bg-black transition-all shadow-sm">
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── ACTIVITY TYPE STYLE MAP ─────────────────────────────────────────────────
const AI_ACTIVITY_TYPES = new Set(['ai_call_completed', 'ai_analysis_generated', 'classified', 'retry_scheduled', 'whatsapp_auto_sent'])

const activityBgColor: Record<string, string> = {
  ai_analysis_generated: 'border-violet-100 bg-violet-50/30',
  classified: 'border-amber-100 bg-amber-50/30',
  retry_scheduled: 'border-orange-100 bg-orange-50/30',
  whatsapp_auto_sent: 'border-green-100 bg-green-50/30',
  ai_call_completed: 'border-violet-100 bg-violet-50/30',
  assignment_update: 'border-blue-100 bg-blue-50/30',
  campaign_call: 'border-indigo-100 bg-indigo-50/30',
}

// Maps a task-completion activity's meta to a coloured outcome chip for the
// timeline, so the lead's Hot/Warm/Cold/Callback history reads at a glance.
function completionOutcomeChip(meta: any): { label: string; cls: string } | null {
  const interest = String(meta?.interest_level ?? '').toLowerCase()
  const callStatus = String(meta?.call_status ?? '').toLowerCase()
  if (['hot', 'warm', 'cold'].includes(interest)) {
    const cls = interest === 'hot' ? 'bg-red-100 text-red-700'
      : interest === 'warm' ? 'bg-yellow-100 text-yellow-700'
      : 'bg-blue-100 text-blue-700'
    return { label: interest.toUpperCase(), cls }
  }
  if (interest === 'not_interested') return { label: 'NOT INTERESTED', cls: 'bg-gray-100 text-gray-600' }
  if (['callback', 'no_answer'].includes(callStatus) || ['busy', 'unknown'].includes(interest)) {
    return { label: 'CALLBACK', cls: 'bg-purple-100 text-purple-700' }
  }
  if (callStatus === 'wrong_number') return { label: 'WRONG NUMBER', cls: 'bg-gray-100 text-gray-600' }
  return null
}

// ─── LEAD TIMELINE ────────────────────────────────────────────────────────────
export function LeadTimeline({ activities }: { activities: Activity[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (!activities.length) return <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
  return (
    <div className="space-y-0 max-h-[62vh] overflow-y-auto pr-1">
      {activities.map((act, i) => (
        <div key={act.id} className="flex gap-3 group">
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-sm flex-shrink-0">
              {activityIcons[act.type] ?? '•'}
            </div>
            {i < activities.length - 1 && <div className="w-px flex-1 bg-gray-100 my-1" />}
          </div>
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">{act.title}</p>
              <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(act.performed_at)}</span>
            </div>

            {/* AI Analysis Generated */}
            {act.type === 'ai_analysis_generated' && (
              <div className={`mt-2 border rounded-xl p-3 ${activityBgColor[act.type]}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-600 text-white">AI Analysis</span>
                  {(act.meta as any)?.score && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      (act.meta as any).score === 'hot' ? 'bg-red-100 text-red-700' :
                      (act.meta as any).score === 'warm' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {String((act.meta as any).score).toUpperCase()} · {(act.meta as any)?.numeric_score ?? '—'}/100
                    </span>
                  )}
                  {(act.meta as any)?.sentiment && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                      (act.meta as any).sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                      (act.meta as any).sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {(act.meta as any).sentiment}
                    </span>
                  )}
                  {(act.meta as any)?.intent_level && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                      Intent: {(act.meta as any).intent_level}
                    </span>
                  )}
                </div>
                {act.description && <p className="text-sm text-gray-700 mt-2">{act.description}</p>}
                {(act.meta as any)?.risk_flags?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[11px] text-red-500 font-medium">Risk flags:</p>
                    <ul className="text-xs text-red-600 mt-0.5 list-disc pl-4">
                      {((act.meta as any).risk_flags as string[]).map((f, idx) => <li key={idx}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Classified (Hot/Warm/Cold) */}
            {act.type === 'classified' && (
              <div className={`mt-2 border rounded-xl p-3 ${activityBgColor[act.type]}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500 text-white">Classification</span>
                  {(act.meta as any)?.classification && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      (act.meta as any).classification === 'hot' ? 'bg-red-100 text-red-700' :
                      (act.meta as any).classification === 'warm' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {String((act.meta as any).classification).toUpperCase()}
                    </span>
                  )}
                </div>
                {act.description && <p className="text-sm text-gray-700 mt-2">{act.description}</p>}
              </div>
            )}

            {/* Retry Scheduled */}
            {act.type === 'retry_scheduled' && (
              <div className={`mt-2 border rounded-xl p-3 ${activityBgColor[act.type]}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500 text-white">Cold Retry</span>
                  {(act.meta as any)?.retry_number && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                      Retry #{(act.meta as any).retry_number} · {(act.meta as any).delay_days}d delay
                    </span>
                  )}
                </div>
                {act.description && <p className="text-sm text-gray-700 mt-2">{act.description}</p>}
              </div>
            )}

            {/* WhatsApp Auto-sent */}
            {act.type === 'whatsapp_auto_sent' && (
              <div className={`mt-2 border rounded-xl p-3 ${activityBgColor[act.type]}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-600 text-white">Auto WhatsApp</span>
                  {(act.meta as any)?.template && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Template: {(act.meta as any).template}
                    </span>
                  )}
                </div>
                {act.description && <p className="text-sm text-gray-600 mt-2 text-xs">{act.description}</p>}
              </div>
            )}

            {/* Campaign Call (existing, preserved) */}
            {act.type === 'campaign_call' && (
              <div className={`mt-2 border rounded-xl p-3 ${activityBgColor[act.type]}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-600 text-white">Campaign Call</span>
                  {act.call_eval_tag && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${act.call_eval_tag.toLowerCase() === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {act.call_eval_tag.toLowerCase() === 'yes' ? 'Objective Met ✓' : 'Objective Not Met ✗'}
                    </span>
                  )}
                  {(act.meta as any)?.campaign_name && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                      📣 {String((act.meta as any).campaign_name).slice(0, 20)}
                    </span>
                  )}
                </div>
                {(act.call_summary || act.description) && (
                  <p className="text-sm text-gray-700 mt-2">{act.call_summary || act.description}</p>
                )}
                {act.recording_url && (
                  <audio controls src={act.recording_url} className="w-full mt-2 h-8" />
                )}
                {act.transcript && (
                  <div className="mt-2">
                    <button
                      onClick={() => setExpanded(prev => ({ ...prev, [act.id]: !prev[act.id] }))}
                      className="text-xs text-indigo-700 hover:underline"
                    >
                      {expanded[act.id] ? 'Hide Transcript' : 'View Transcript'}
                    </button>
                    {expanded[act.id] && (
                      <p className="text-xs whitespace-pre-wrap text-gray-600 mt-1 bg-white rounded-lg p-2 border border-indigo-100">
                        {act.transcript.length > 2000 ? `${act.transcript.slice(0, 2000)}...` : act.transcript}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Task completion — show the agent's outcome (heat / callback) as a
                coloured chip so the lead's history reads at a glance down the timeline. */}
            {act.type === 'task_completion_remark' && (() => {
              const chip = completionOutcomeChip(act.meta)
              return chip ? (
                <div className="mt-1.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${chip.cls}`}>{chip.label}</span>
                </div>
              ) : null
            })()}

            {/* Generic description for non-special types */}
            {!AI_ACTIVITY_TYPES.has(act.type) && act.type !== 'campaign_call' && act.type !== 'classified' && act.description && (
              <p className="text-sm text-gray-600 mt-0.5">{act.description}</p>
            )}
            {act.outcome && <span className="text-xs text-indigo-600 font-medium">{act.outcome}</span>}
            {act.performed_by_agent && <p className="text-xs text-gray-400 mt-0.5">by {act.performed_by_agent.name}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── ADD NOTE ─────────────────────────────────────────────────────────────────
export function AddNoteBox({ leadId }: { leadId: string }) {
  const [text, setText] = useState('')
  const { mutateAsync, isPending } = useAddNote(leadId)
  const submit = async () => {
    if (!text.trim()) return
    await mutateAsync(text)
    setText('')
    toast.success('Note added')
  }
  return (
    <div className="border border-gray-100/80 bg-[#fbfbfd] rounded-3xl p-4 shadow-sm">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
        placeholder="Add a note about this lead..." className="w-full text-[14px] bg-transparent text-[#1d1d1f] resize-none outline-none" />
      <div className="flex justify-end mt-2">
        <button onClick={submit} disabled={!text.trim() || isPending}
          className="px-5 py-2 bg-[#1d1d1f] text-white font-semibold text-[13px] rounded-full disabled:opacity-50 hover:bg-black transition-all shadow-sm">
          {isPending ? 'Saving...' : 'Save note'}
        </button>
      </div>
    </div>
  )
}


// ─── QUICK CALL LOG ──────────────────────────────────────────────────────────
const OUTCOMES = [
  { key: 'answered', label: 'Answered', color: 'bg-green-50 border-green-300 text-green-700' },
  { key: 'voicemail', label: 'Voicemail', color: 'bg-amber-50 border-amber-300 text-amber-700' },
  { key: 'not_interested', label: 'Not interested', color: 'bg-red-50 border-red-300 text-red-700' },
  { key: 'callback_requested', label: 'Callback requested', color: 'bg-blue-50 border-blue-300 text-blue-700' },
]

export function QuickCallLog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const { mutateAsync, isPending } = useLogCall(leadId)

  const submit = async () => {
    if (!outcome) return
    await mutateAsync({ outcome, description: notes })
    toast.success('Call logged')
    onClose()
  }

  return (
    <div className="border border-gray-100/80 rounded-3xl p-5 bg-[#fbfbfd] shadow-sm">
      <p className="text-[15px] font-semibold tracking-tight text-[#1d1d1f] mb-4">Log a call</p>
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {OUTCOMES.map(o => (
          <button key={o.key} onClick={() => setOutcome(o.key)}
            className={`px-3 py-2.5 border rounded-xl text-[12px] font-semibold transition-all ${outcome === o.key ? o.color : 'bg-white border-gray-200/60 text-[#86868b] hover:border-gray-300 hover:text-[#1d1d1f]'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        placeholder="Notes (optional)..."
        className="w-full text-[13px] border border-gray-200/80 rounded-xl p-3 outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-100 resize-none bg-white transition-all" />
      <div className="flex gap-2.5 mt-4">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200/80 rounded-full text-sm font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-white transition-all">Cancel</button>
        <button onClick={submit} disabled={!outcome || isPending}
          className="flex-1 py-2.5 bg-[#1d1d1f] text-white rounded-full text-sm font-semibold disabled:opacity-50 hover:bg-black transition-all shadow-sm">
          {isPending ? 'Logging...' : 'Log call'}
        </button>
      </div>
    </div>
  )
}


// ─── WHATSAPP SENDER ──────────────────────────────────────────────────────────
const TEMPLATES = [
  { key: 'follow_up', label: 'Follow-up message' },
  { key: 'site_visit_confirmation', label: 'Visit confirmation' },
  { key: 'new_listing_alert', label: 'New listing alert' },
  { key: 'general_followup', label: 'General follow-up' },
]

export function WhatsAppSender({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [template, setTemplate] = useState('')
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!template) return
    setLoading(true)
    try {
      await leadsApi.sendWhatsApp(leadId, template)
      toast.success('WhatsApp message sent!')
      onClose()
    } catch {
      toast.error('Failed to send message')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-gray-100/80 rounded-3xl p-5 bg-[#fbfbfd] shadow-sm">
      <p className="text-[15px] font-semibold tracking-tight text-[#1d1d1f] mb-4">Send WhatsApp</p>
      <div className="space-y-2 mb-4">
        {TEMPLATES.map(t => (
          <button key={t.key} onClick={() => setTemplate(t.key)}
            className={`w-full text-left px-4 py-3 border rounded-xl text-[13px] transition-all font-medium ${template === t.key ? 'border-gray-900 bg-[#1d1d1f] text-white shadow-sm' : 'border-gray-200/60 bg-white text-[#86868b] hover:border-gray-300 hover:text-[#1d1d1f]'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200/80 rounded-full text-sm font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-white transition-all bg-white">Cancel</button>
        <button onClick={send} disabled={!template || loading}
          className="flex-1 py-2.5 bg-[#1d1d1f] text-white rounded-full text-sm font-semibold disabled:opacity-50 hover:bg-black transition-all shadow-sm">
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}


// ─── CAMPAIGN WHATSAPP SENDER ─────────────────────────────────────────────────
export function CampaignWhatsAppSender({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [campaign, setCampaign] = useState('Day 1')
  const [loading, setLoading] = useState(false)

  const send = async () => {
    if (!message.trim()) return
    setLoading(true)
    try {
      await leadsApi.campaignTrigger(leadId, message, campaign)
      toast.success('Campaign WhatsApp sent!')
      onClose()
    } catch {
      toast.error('Failed to send campaign message')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-green-100 rounded-3xl p-5 bg-[#f6fef9] shadow-sm">
      <p className="text-[15px] font-semibold tracking-tight text-[#1d1d1f] mb-4">Campaign WhatsApp</p>
      <div className="space-y-3 mb-4">
        <div>
          <label className="text-[11px] font-semibold text-[#887d72] uppercase tracking-widest mb-1 block">Campaign Tag</label>
          <input
            value={campaign}
            onChange={e => setCampaign(e.target.value)}
            placeholder="e.g. Day 1, Follow-up"
            className="w-full px-4 py-2.5 border border-gray-200/80 rounded-xl text-[13px] bg-white focus:outline-none focus:border-green-400"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-[#887d72] uppercase tracking-widest mb-1 block">Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="Hi Rahul ji, following up on Krishna Aura..."
            className="w-full px-4 py-2.5 border border-gray-200/80 rounded-xl text-[13px] bg-white focus:outline-none focus:border-green-400 resize-none"
          />
        </div>
      </div>
      <div className="flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200/80 rounded-full text-sm font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-white transition-all bg-white">Cancel</button>
        <button onClick={send} disabled={!message.trim() || loading}
          className="flex-1 py-2.5 bg-green-600 text-white rounded-full text-sm font-semibold disabled:opacity-50 hover:bg-green-700 transition-all shadow-sm">
          {loading ? 'Sending...' : 'Send Campaign'}
        </button>
      </div>
    </div>
  )
}


// ─── PROPERTY MATCH PANEL ─────────────────────────────────────────────────────
export function PropertyMatchPanel({ leadId }: { leadId: string }) {
  const { data: properties, isLoading } = usePropertyMatches(leadId)

  if (isLoading) return <p className="text-sm text-gray-400">Finding matches...</p>
  if (!properties?.length) return <p className="text-sm text-gray-400">No matching properties found</p>

  return (
    <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
      {properties.map(p => (
        <div key={p.id} className="border border-gray-200 rounded-xl p-3 bg-white">
          <p className="text-sm font-semibold text-gray-900">{p.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{p.locality}, {p.city}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-sm font-bold text-indigo-700">{formatCurrency(p.price)}</span>
            {p.bedrooms && <span className="text-xs text-gray-400">{p.bedrooms} BHK</span>}
            {p.area_sqft && <span className="text-xs text-gray-400">{p.area_sqft.toLocaleString()} sqft</span>}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ml-auto ${p.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {p.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── TASK LIST ────────────────────────────────────────────────────────────────
export function TaskList({ tasks, onCompleteTask }: { tasks: Task[]; onCompleteTask?: (task: Task) => void }) {
  const { mutateAsync: complete } = useCompleteTask()

  const handleComplete = (task: Task) => {
    if (onCompleteTask) {
      onCompleteTask(task)
    } else {
      complete(task.id)
    }
  }

  if (!tasks.length) return <p className="text-sm text-gray-400 py-4 text-center">No tasks</p>

  return (
    <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
      {tasks.map(t => (
        <div key={t.id} className={`flex items-start gap-3 p-3 rounded-xl border ${t.status === 'done' ? 'border-green-200 bg-green-50/30' : t.status === 'overdue' ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white'}`}>
          {t.status === 'done' ? (
            <div className="w-5 h-5 rounded border-2 border-green-500 bg-green-500 flex-shrink-0 mt-0.5 flex items-center justify-center">
              <span className="text-white text-xs">✓</span>
            </div>
          ) : (
            <button onClick={() => handleComplete(t)}
              className="w-5 h-5 rounded border-2 border-gray-300 hover:border-[#c86f43] hover:bg-[#fef8f4] flex-shrink-0 mt-0.5 transition-colors" />
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${t.status === 'done' ? 'text-green-700 line-through' : t.status === 'overdue' ? 'text-red-700 font-medium' : 'text-gray-800'}`}>{t.title}</p>
            {t.due_at && <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(t.due_at)}</p>}
            {t.completion_remark && (
              <p className="text-xs text-gray-500 mt-1 italic border-l-2 border-green-300 pl-2">{t.completion_remark.slice(0, 120)}{t.completion_remark.length > 120 ? '...' : ''}</p>
            )}
            {t.completion_tags && t.completion_tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {t.completion_tags.map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-md">{tag}</span>
                ))}
              </div>
            )}
            {typeof t.remark_quality_score === 'number' && (
              <div className="mt-1.5 space-y-1">
                <p className="text-[11px] text-[#5f5348]">
                  Remark Quality: <span className="font-semibold">{t.remark_quality_score.toFixed(1)}/10</span>
                </p>
                {t.remark_quality_feedback ? (
                  <p className="text-[11px] text-[#7f7266]">{t.remark_quality_feedback}</p>
                ) : null}
              </div>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${t.priority === 'high' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
            {t.priority}
          </span>
        </div>
      ))}
    </div>
  )
}

