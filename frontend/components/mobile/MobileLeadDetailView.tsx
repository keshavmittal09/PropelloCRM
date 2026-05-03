'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Activity, Lead, Task } from '@/lib/types'
import { UnifiedTaskCompletionSheet } from '@/components/tasks/UnifiedTaskCompletionSheet'

interface Props {
  lead: Lead
  activities: Activity[]
  tasks: Task[]
}

const STAGE_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  site_visit_scheduled: 'Site Visit',
  site_visit_done: 'Visited',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
}

const SCORE_COLORS: Record<string, { badge: string }> = {
  hot: { badge: 'bg-red-100 text-red-700' },
  warm: { badge: 'bg-amber-100 text-amber-700' },
  cold: { badge: 'bg-blue-100 text-blue-700' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function MobileLeadDetailView({ lead, activities, tasks }: Props) {
  const router = useRouter()
  const [completingTask, setCompletingTask] = useState<Task | null>(null)

  const colors = SCORE_COLORS[lead.lead_score as keyof typeof SCORE_COLORS] ?? SCORE_COLORS.warm
  const stageLabel = STAGE_LABELS[lead.stage] ?? lead.stage
  const masterProfile = (lead.master_profile ?? {}) as Record<string, unknown>
  const getProfileText = (key: string): string | null => {
    const value = masterProfile[key]
    return typeof value === 'string' && value.trim() ? value : null
  }

  const name = lead.contact?.name ?? getProfileText('full_name') ?? 'Lead'
  const phone = lead.contact?.phone ?? ''
  const recentActivities = (activities ?? []).slice(0, 3)
  const pendingTasks = (tasks ?? []).filter((task) => task.status !== 'done')

  const demoFields = [
    lead.age_range,
    lead.occupation,
    lead.family_size,
    lead.income_range,
    lead.property_budget,
    lead.preferred_location,
    lead.purchase_timeline,
  ]
  const filledCount = demoFields.filter((value) => value && value !== 'unknown').length
  const completeness = Math.round((filledCount / 7) * 100)

  return (
    <div className="min-h-screen bg-[#f8f4ef] pb-20">
      <div className="bg-white border-b border-[#e8ddcf] px-4 pt-4 pb-5">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7b7166] hover:bg-[#f0e8de] transition-colors"
          >
            ←
          </button>
          <div className="flex-1" />
          {phone && (
            <a
              href={`tel:${phone}`}
              className="px-3 py-1.5 rounded-xl bg-[#f0f7ff] border border-blue-200 text-blue-700 text-xs font-semibold"
            >
              📞 Call
            </a>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-[#1f1914]">{name}</h1>
            {phone && <p className="text-sm text-[#8f8378] font-mono mt-0.5">{phone}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${colors.badge}`}>
              {lead.lead_score}
            </span>
            <span className="text-xs bg-[#f5f0e8] text-[#6e6357] px-2 py-0.5 rounded-full">
              {stageLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="px-3 pt-4 space-y-4">
        <div className="bg-white rounded-2xl border border-[#e8ddcf] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#1f1914] text-sm">Master Profile</h2>
            <span className="text-xs text-[#8f8378]">{completeness}% complete</span>
          </div>
          <div className="w-full h-1.5 bg-[#f0ebe5] rounded-full mb-4">
            <div className="h-full bg-[#c86f43] rounded-full transition-all" style={{ width: `${completeness}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {[
              ['Full Name', getProfileText('full_name') ?? name],
              ['Email', getProfileText('email')],
              ['Alternate', getProfileText('alternate_phone')],
              ['City', getProfileText('city')],
              ['Locality', getProfileText('locality')],
              ['Occupation', getProfileText('occupation')],
              ['Family', getProfileText('family_size')],
              ['Living', getProfileText('current_living_situation')],
              ['Purpose', getProfileText('investment_purpose')],
              ['Source', getProfileText('source') ?? lead.source],
              ['Budget', getProfileText('property_budget')],
              ['Timeline', getProfileText('purchase_timeline')],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] text-[#8f8378]">{label}</p>
                <p className="text-sm font-medium text-[#2b241e]">{value ?? '—'}</p>
              </div>
            ))}
          </div>
          {(getProfileText('ai_summary') || getProfileText('key_quote')) && (
            <div className="mt-4 space-y-3">
              {getProfileText('ai_summary') && (
                <div>
                  <p className="text-[11px] text-[#8f8378] mb-1">AI Summary</p>
                  <p className="text-sm text-[#4f453b] leading-relaxed">{getProfileText('ai_summary')}</p>
                </div>
              )}
              {getProfileText('key_quote') && (
                <div>
                  <p className="text-[11px] text-[#8f8378] mb-1">Key Quote</p>
                  <p className="text-sm text-[#4f453b] italic leading-relaxed">“{getProfileText('key_quote')}”</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-[#e8ddcf] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#1f1914] text-sm">Customer Profile</h2>
            <span className="text-xs text-[#8f8378]">{completeness}% complete</span>
          </div>
          <div className="w-full h-1.5 bg-[#f0ebe5] rounded-full mb-4">
            <div className="h-full bg-[#c86f43] rounded-full transition-all" style={{ width: `${completeness}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {[
              ['Age', lead.age_range],
              ['Occupation', lead.occupation],
              ['Family', lead.family_size],
              ['Income', lead.income_range],
              ['Budget', lead.property_budget],
              ['Timeline', lead.purchase_timeline],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] text-[#8f8378]">{label}</p>
                <p className="text-sm font-medium text-[#2b241e]">{value ?? '—'}</p>
              </div>
            ))}
            {lead.preferred_location ? (
              <div className="col-span-2">
                <p className="text-[11px] text-[#8f8378]">Preferred Location</p>
                <p className="text-sm font-medium text-[#2b241e]">{lead.preferred_location}</p>
              </div>
            ) : null}
          </div>
        </div>

        {lead.last_call_status && (
          <div className="bg-white rounded-2xl border border-[#e8ddcf] p-4">
            <h2 className="font-semibold text-[#1f1914] text-sm mb-2">Last Call</h2>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  lead.last_call_status === 'connected'
                    ? 'bg-green-100 text-green-700'
                    : lead.last_call_status === 'no_answer'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {lead.last_call_status.replace('_', ' ')}
              </span>
              {lead.last_call_interest && (
                <span className="text-xs text-[#8f8378]">
                  · Interest: <span className="capitalize">{lead.last_call_interest}</span>
                </span>
              )}
            </div>
            {lead.last_call_topics && lead.last_call_topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {lead.last_call_topics.map((topic) => (
                  <span key={topic} className="text-[10px] bg-[#f5f0e8] text-[#6e6357] px-2 py-0.5 rounded-full capitalize">
                    {topic.replace('_', ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {pendingTasks.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#e8ddcf] p-4">
            <h2 className="font-semibold text-[#1f1914] text-sm mb-3">Pending Tasks</h2>
            <div className="space-y-2">
              {pendingTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#2b241e] truncate">{task.title}</p>
                    {task.due_at && (
                      <p className={`text-xs ${new Date(task.due_at) < new Date() ? 'text-red-600 font-semibold' : 'text-[#8f8378]'}`}>
                        {new Date(task.due_at) < new Date()
                          ? '⚠️ Overdue'
                          : new Date(task.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setCompletingTask(task)}
                    className="px-3 py-1.5 rounded-xl bg-[#2f2317] text-white text-xs font-semibold flex-shrink-0"
                  >
                    Done
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentActivities.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#e8ddcf] p-4">
            <h2 className="font-semibold text-[#1f1914] text-sm mb-3">Recent Activity</h2>
            <div className="space-y-3">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#d4c5b2] mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#2b241e]">{activity.title}</p>
                    {activity.description && (
                      <p className="text-xs text-[#8f8378] mt-0.5 line-clamp-2">{activity.description}</p>
                    )}
                    <p className="text-[11px] text-[#b8a895] mt-0.5">{timeAgo(activity.performed_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(lead.budget_min || lead.budget_max) && (
          <div className="bg-white rounded-2xl border border-[#e8ddcf] p-4">
            <h2 className="font-semibold text-[#1f1914] text-sm mb-2">Budget</h2>
            <p className="text-sm text-[#2b241e]">
              {lead.budget_min ? `₹${(lead.budget_min / 100000).toFixed(0)}L` : ''}
              {lead.budget_min && lead.budget_max ? ' – ' : ''}
              {lead.budget_max ? `₹${(lead.budget_max / 100000).toFixed(0)}L` : ''}
            </p>
          </div>
        )}
      </div>

      {completingTask && (
        <UnifiedTaskCompletionSheet
          task={completingTask}
          lead={lead}
          onClose={() => setCompletingTask(null)}
          onComplete={() => setCompletingTask(null)}
        />
      )}
    </div>
  )
}
