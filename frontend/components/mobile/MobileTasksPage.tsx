'use client'
import { useState } from 'react'
import { useAllTasks } from '@/hooks/useQueries'
import { MobileTaskCard } from './MobileTaskCard'
import { MobileHeader } from '@/components/mobile/MobileHeader'
import { UnifiedTaskCompletionSheet } from '@/components/tasks/UnifiedTaskCompletionSheet'
import type { Task } from '@/lib/types'

type Filter = 'all' | 'pending' | 'done'

interface Props {
  title?: string
  subtitle?: string
  showBack?: boolean
}

export default function MobileTasksPage({
  title = 'My Tasks',
  subtitle,
  showBack = true,
}: Props) {
  const [filter, setFilter] = useState<Filter>('pending')
  const [completingTask, setCompletingTask] = useState<Task | null>(null)

  const { data: tasks, isLoading } = useAllTasks(
    filter === 'all' ? undefined : filter === 'pending' ? { status: 'pending' } : { status: 'done' },
  )

  const sorted = [...(tasks ?? [])].sort((a, b) => {
    if (!a.due_at) return 1
    if (!b.due_at) return -1
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  })

  const overdue = sorted.filter((task) => {
    if (!task.due_at) return false
    return new Date(task.due_at) < new Date() && task.status !== 'done'
  })
  const today = sorted.filter((task) => {
    if (!task.due_at) return false
    const dueDate = new Date(task.due_at)
    const now = new Date()
    return dueDate.toDateString() === now.toDateString() && task.status !== 'done'
  })
  const upcoming = sorted.filter((task) => {
    if (!task.due_at) return false
    const dueDate = new Date(task.due_at)
    const now = new Date()
    return dueDate > now && task.status !== 'done'
  })
  const done = sorted.filter((task) => task.status === 'done')

  const counts = {
    all: sorted.length,
    pending: (tasks ?? []).filter((task) => task.status !== 'done').length,
    done: done.length,
  }

  return (
    <div className="min-h-screen bg-[#f8f4ef] pb-20">
      <MobileHeader title={title} subtitle={subtitle ?? `${counts.pending} pending`} showBack={showBack} />

      <div className="sticky top-[60px] z-10 bg-white border-b border-[#e8ddcf] px-4">
        <div className="flex gap-1 mt-0">
          {(['all', 'pending', 'done'] as Filter[]).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`flex-1 py-2 text-xs font-semibold rounded-t-xl transition-colors capitalize ${
                filter === item ? 'bg-[#2f2317] text-white' : 'text-[#8f8378] hover:text-[#4f453b]'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-2.5">
        {isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((index) => (
              <div key={index} className="bg-white rounded-2xl h-28 animate-pulse border border-[#e8ddcf]" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-[#8f8378] font-medium">All caught up!</p>
            <p className="text-xs text-[#b8a895] mt-1">No tasks here.</p>
          </div>
        ) : (
          <>
            {filter !== 'done' && overdue.length > 0 && (
              <Section title="Overdue" tasks={overdue} onComplete={setCompletingTask} />
            )}
            {filter !== 'done' && today.length > 0 && (
              <Section title="Today" tasks={today} onComplete={setCompletingTask} />
            )}
            {filter !== 'done' && upcoming.length > 0 && (
              <Section title="Upcoming" tasks={upcoming} onComplete={setCompletingTask} />
            )}
            {filter !== 'pending' && done.length > 0 && (
              <Section title="Done" tasks={done} onComplete={setCompletingTask} />
            )}
          </>
        )}
      </div>

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

function Section({ title, tasks, onComplete }: { title: string; tasks: Task[]; onComplete: (task: Task) => void }) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-2 px-1 ${title === 'Overdue' ? 'text-red-600' : 'text-[#8f8378]'}`}>
        {title}
      </p>
      <div className="space-y-2">
        {tasks.map((task) => (
          <MobileTaskCard key={task.id} task={task} onComplete={onComplete} />
        ))}
      </div>
    </div>
  )
}
