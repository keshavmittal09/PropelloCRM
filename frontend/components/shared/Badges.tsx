import { scoreConfig, sourceLabels, sourceColors, daysInStageColor } from '@/lib/utils'
import { cn } from '@/lib/cn'
import type { LeadScore, LeadSource } from '@/lib/types'

export function ScoreBadge({ score }: { score: LeadScore }) {
  const cfg = scoreConfig[score]
  return (
    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', cfg.className)}>
      {cfg.label}
    </span>
  )
}

export function SourceTag({ source }: { source: string }) {
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', sourceColors[source] ?? 'bg-gray-100 text-gray-600')}>
      {sourceLabels[source as LeadSource] ?? source}
    </span>
  )
}

export function DaysInStage({ days }: { days: number }) {
  return (
    <span className={cn('text-xs font-medium', daysInStageColor(days))}>
      {days === 0 ? 'Today' : `${days}d`}
    </span>
  )
}

export function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: 'bg-red-500',
    normal: 'bg-gray-300',
    low: 'bg-gray-200',
  }
  return <span className={cn('inline-block w-2 h-2 rounded-full', colors[priority] ?? 'bg-gray-300')} />
}
