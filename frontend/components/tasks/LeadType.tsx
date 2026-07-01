import type { Task } from '@/lib/types'

// ─── Lead-type badge (hot / warm / cold / …) ─────────────────────────────────
const LEAD_TYPE_BADGE: Record<string, string> = {
  hot: 'bg-red-100 text-red-700 border-red-200',
  warm: 'bg-amber-100 text-amber-700 border-amber-200',
  cold: 'bg-blue-100 text-blue-700 border-blue-200',
  not_interested: 'bg-gray-100 text-gray-600 border-gray-200',
  busy: 'bg-purple-100 text-purple-700 border-purple-200',
  unknown: 'bg-gray-100 text-gray-500 border-gray-200',
}

export function LeadTypeBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-[#b8a895]">—</span>
  const key = value.toLowerCase().replace(/\s+/g, '_')
  const cls = LEAD_TYPE_BADGE[key] ?? 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${cls}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

// Parse the structured completion remark the call sheet writes, e.g.
// "Call status: Yes, Connected. Interest: Hot. Follow-up on: 12 Jul 2026, 09:00 AM. …"
// Falls back to the lead's stored call fields when the remark isn't structured.
export function parseCompletion(task: Task): { connected: boolean; leadType: string | null; remark: string } {
  const remark = task.completion_remark ?? ''
  const grab = (re: RegExp) => remark.match(re)?.[1]?.trim() || null

  const callStatus = grab(/Call status:\s*([^.]+)/i)
  const interest = grab(/Interest:\s*([^.]+)/i)
  const followUp = grab(/Follow-up on:\s*([^.]+?)(?:\.\s|\.$|$)/i)

  const lead = task.lead
  const statusText = callStatus ?? lead?.last_call_status ?? ''
  const connected = /connect/i.test(statusText) || lead?.last_call_status === 'connected'
  const leadType = connected ? (interest ?? lead?.last_call_interest ?? null) : null

  let remarkText: string
  if (connected) {
    remarkText = followUp ? `Follow-up: ${followUp}` : (interest ? interest : 'Connected')
  } else if (/wrong/i.test(statusText) || lead?.last_call_status === 'wrong_number') {
    remarkText = 'Wrong Number'
  } else if (/call\s*back|callback/i.test(statusText) || lead?.last_call_status === 'callback') {
    remarkText = 'Call Back Later'
  } else if (/no\s*answer/i.test(statusText) || lead?.last_call_status === 'no_answer') {
    remarkText = 'No Answer'
  } else {
    remarkText = callStatus || (lead?.last_remark ? lead.last_remark.split('\n')[0].slice(0, 60) : '—')
  }

  return { connected, leadType, remark: remarkText }
}
