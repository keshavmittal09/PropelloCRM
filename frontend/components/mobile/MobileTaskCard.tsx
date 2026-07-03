'use client'
import Link from 'next/link'
import type { Task } from '@/lib/types'
import { LeadTypeBadge, parseCompletion } from '@/components/tasks/LeadType'

interface Props {
  task: Task
  onComplete: (task: Task) => void
}

function formatDue(dueAt: string | null): { label: string; isOverdue: boolean; isToday: boolean } {
  if (!dueAt) return { label: 'No due date', isOverdue: false, isToday: false }

  const due = new Date(dueAt)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000)
  const startOfDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())

  if (startOfDay < startOfToday) {
    return { label: 'Overdue', isOverdue: true, isToday: false }
  }
  if (startOfDay.getTime() === startOfToday.getTime()) {
    const timeStr = due.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    return { label: `Today · ${timeStr}`, isOverdue: false, isToday: true }
  }
  if (startOfDay.getTime() === startOfTomorrow.getTime()) {
    return { label: 'Tomorrow', isOverdue: false, isToday: false }
  }
  const diff = Math.round((due.getTime() - now.getTime()) / 3600000)
  if (diff < 24) return { label: `In ${diff}h`, isOverdue: false, isToday: false }
  return { label: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), isOverdue: false, isToday: false }
}

const PRIORITY_COLORS = {
  high: { border: 'border-red-500', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  normal: { border: 'border-amber-400', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  low: { border: 'border-blue-400', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
}

export function MobileTaskCard({ task, onComplete }: Props) {
  const colors = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] ?? PRIORITY_COLORS.normal
  const due = formatDue(task.due_at)
  const profileName = typeof task.lead?.master_profile?.full_name === 'string' ? task.lead.master_profile.full_name : null
  const leadName = task.lead?.contact?.name ?? profileName ?? 'Lead'
  const leadPhone = task.lead?.contact?.phone ?? ''
  const callUrl = leadPhone ? `tel:${leadPhone}` : null

  return (
    <div className={`bg-white rounded-2xl border-l-4 ${colors.border} border border-[#e8ddcf] border-l-4 shadow-sm overflow-hidden`}>
      <div className="px-4 py-3.5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#1f1914] text-sm truncate">{leadName}</p>
            {callUrl ? (
              <a href={callUrl} className="text-xs text-blue-700 font-semibold mt-0.5 inline-flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                {leadPhone}
              </a>
            ) : (
              <p className="text-xs text-[#8f8378] mt-0.5 truncate">{task.title}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {task.status !== 'done' && task.lead?.lead_score && (
              <LeadTypeBadge value={task.lead.lead_score} />
            )}
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${colors.badge}`}>
              {task.priority}
            </span>
          </div>
        </div>

        {/* Due time */}
        <div className={`text-xs mt-1 flex items-center gap-1 ${due.isOverdue ? 'text-red-600 font-semibold' : due.isToday ? 'text-amber-600' : 'text-[#8f8378]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors.dot}`} />
          {due.label}
        </div>

        {/* Completed call outcome — Your Lead + Your Remarks */}
        {task.status === 'done' && (() => {
          const c = parseCompletion(task)
          return (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-[#8f8378]">Your lead:</span>
              <LeadTypeBadge value={c.leadType} />
              <span className="text-[#8f8378] ml-1">·</span>
              <span className={c.connected ? 'text-[#2f7a4e] font-medium' : 'text-[#8a7f74]'}>{c.remark}</span>
            </div>
          )
        })()}

        {/* Action buttons — done tasks only show Call (no redundant Done button) */}
        {(task.status !== 'done' || callUrl) && (
          <div className="flex gap-2 mt-3">
            {callUrl && (
              <a
                href={callUrl}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#f0f7ff] border border-blue-200 text-blue-700 text-sm font-semibold active:bg-blue-50 transition-colors"
              >
                <span>📞</span> Call
              </a>
            )}
            {task.status !== 'done' && (
              <button
                onClick={() => onComplete(task)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#2f2317] text-white text-sm font-semibold active:bg-[#1f1610] transition-colors"
              >
                <span>✅</span> Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
