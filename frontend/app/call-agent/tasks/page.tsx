'use client'
import { useState } from 'react'
import { useAllTasks } from '@/hooks/useQueries'
import { useAuthStore } from '@/store/useAuthStore'
import { MobileTaskCard } from '@/components/mobile/MobileTaskCard'
import { UnifiedTaskCompletionSheet } from '@/components/tasks/UnifiedTaskCompletionSheet'
import { MobileHeader } from '@/components/mobile/MobileHeader'
import type { Task } from '@/lib/types'

type Filter = 'all' | 'pending' | 'followup' | 'done'

export default function MobileTasksPage() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [completingTask, setCompletingTask] = useState<Task | null>(null)
  const agentId = useAuthStore(s => s.agent?.id)

  const { data: tasks, isLoading } = useAllTasks()

  // Only show tasks for leads currently assigned to me — not stale tasks left
  // over from leads that were reassigned to another agent. This keeps the count
  // correct even before the backend fix is deployed.
  const myTasks = (tasks ?? []).filter(t => !t.lead || t.lead.assigned_to === agentId)

  // Sort: overdue first, then due today, then future
  const sorted = [...myTasks].sort((a, b) => {
    if (!a.due_at) return 1
    if (!b.due_at) return -1
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  })

  // Leads the agent has already completed a task for belong in Done — not
  // Pending. This makes a completed lead move out of the pending list even if
  // completing it created a follow-up task.
  const doneLeadIds = new Set(
    sorted.filter(t => t.status === 'done' && t.lead_id).map(t => t.lead_id as string)
  )

  // One card per lead on the pending tabs. A lead can have several tasks (the
  // original assignment plus follow-ups), so dedupe by lead — the count then
  // reflects assigned leads, not raw task rows.
  const seenLead = new Set<string>()
  const pendingByLead = sorted.filter(t => {
    if (t.status === 'done') return false
    if (t.lead_id && doneLeadIds.has(t.lead_id)) return false
    const key = t.lead_id ?? t.id
    if (seenLead.has(key)) return false
    seenLead.add(key)
    return true
  })

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000)

  const followup = pendingByLead.filter(t => (t.task_type === 'follow_up' || t.title?.toLowerCase().includes('follow')) && t.due_at)
  const generalPending = pendingByLead.filter(t => !followup.includes(t))

  const listToGroup = (filter === 'pending') ? generalPending : pendingByLead

  const overdue = listToGroup.filter(t => t.due_at && new Date(t.due_at) < startOfToday)
  const today = listToGroup.filter(t => {
    if (!t.due_at) return false
    const d = new Date(t.due_at)
    return d >= startOfToday && d < startOfTomorrow
  })
  const upcoming = listToGroup.filter(t => t.due_at && new Date(t.due_at) >= startOfTomorrow)
  // Pending tasks with no due date — these must still appear on Pending/All.
  const noDate = listToGroup.filter(t => !t.due_at)
  
  const done = sorted.filter(t => t.status === 'done')

  const counts = {
    all: pendingByLead.length + done.length,
    pending: generalPending.length,
    followup: followup.length,
    done: done.length,
  }

  // Tasks actually visible on the current tab (drives the empty state).
  const visibleCount = filter === 'done'
    ? done.length
    : filter === 'pending'
      ? generalPending.length
      : filter === 'followup'
        ? followup.length
        : counts.all

  return (
    <div className="min-h-screen bg-[#f8f4ef] pb-20">
      <MobileHeader title={<>Tasks <span className="text-[#8f8378]"></span></>} subtitle={
        filter === 'done' ? `${counts.done} done`
          : filter === 'pending' ? `${counts.pending} pending`
            : `${counts.all} tasks`
      } />

      {/* Filter tabs */}
      <div className="sticky top-[60px] z-10 bg-white border-b border-[#e8ddcf] px-4">
        <div className="flex gap-1 mt-0">
          {(['all', 'pending', 'followup', 'done'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 text-xs font-semibold rounded-t-xl transition-colors capitalize ${
                filter === f
                  ? 'bg-[#2f2317] text-white'
                  : 'text-[#8f8378] hover:text-[#4f453b]'
              }`}
            >
              {f} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="px-3 pt-3 space-y-2.5">
        {isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl h-28 animate-pulse border border-[#e8ddcf]" />
            ))}
          </div>
        ) : visibleCount === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-[#8f8378] font-medium">All caught up!</p>
            <p className="text-xs text-[#b8a895] mt-1">No tasks here.</p>
          </div>
        ) : (
          <>
            {filter !== 'done' && filter !== 'followup' && overdue.length > 0 && (
              <Section title="Overdue" tasks={overdue} onComplete={setCompletingTask} />
            )}
            {filter !== 'done' && filter !== 'followup' && today.length > 0 && (
              <Section title="Today" tasks={today} onComplete={setCompletingTask} />
            )}
            {filter !== 'done' && filter !== 'followup' && upcoming.length > 0 && (
              <Section title="Upcoming" tasks={upcoming} onComplete={setCompletingTask} />
            )}
            {filter !== 'done' && filter !== 'followup' && noDate.length > 0 && (
              <Section title="No due date" tasks={noDate} onComplete={setCompletingTask} />
            )}
            {filter === 'followup' && followup.length > 0 && (
              <Section title="Follow Up (Scheduled)" tasks={followup} onComplete={setCompletingTask} />
            )}
            {filter !== 'pending' && filter !== 'followup' && done.length > 0 && (
              <Section title="Done" tasks={done} onComplete={setCompletingTask} />
            )}
          </>
        )}
      </div>

      {/* Task completion bottom sheet */}
      {completingTask && (
        <UnifiedTaskCompletionSheet
          task={completingTask}
          lead={null}
          onClose={() => setCompletingTask(null)}
          onComplete={() => setCompletingTask(null)}
        />
      )}
    </div>
  )
}

function Section({ title, tasks, onComplete }: { title: string; tasks: Task[]; onComplete: (t: Task) => void }) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-2 px-1 ${title === 'Overdue' ? 'text-red-600' : 'text-[#8f8378]'}`}>{title}</p>
      <div className="space-y-2">
        {tasks.map(task => (
          <MobileTaskCard key={task.id} task={task} onComplete={onComplete} />
        ))}
      </div>
    </div>
  )
}