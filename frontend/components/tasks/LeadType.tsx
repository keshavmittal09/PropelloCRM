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

const TEMPERATURES = ['hot', 'warm', 'cold']

// Strip bracketed system notes (e.g. "[Task completed via mobile form]") and
// drop placeholder / "unknown" values so they never surface in the table.
function clean(value?: string | null): string | null {
  if (!value) return null
  const v = value.replace(/\[[^\]]*\]/g, '').trim()
  if (!v) return null
  if (/^(don'?t\s*know|unknown|not\s*needed|n\/?a|none)$/i.test(v)) return null
  return v
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Derive a short, clean call outcome for the Done board — never the raw remark
// dump. Works whether the completion remark is punctuated
// ("Call status: Yes, Connected. Interest: Warm.") or not
// ("Call status Connected Interest Warm Discussed Location"). Falls back to the
// lead's stored call fields.
export function parseCompletion(task: Task): { connected: boolean; leadType: string | null; remark: string } {
  const remark = task.completion_remark ?? ''
  const lead = task.lead

  const statusRaw = remark.match(/Call status:?\s*(Yes,?\s*Connected|Connected|No Answer|Wrong Number|Call Back Later|Callback)/i)?.[1] ?? null
  const interestRaw = remark.match(/Interest:?\s*(Hot|Warm|Cold|Not Interested|Busy|Channel Partner|Don'?t Know|Unknown)/i)?.[1] ?? null
  const followUp = remark.match(/Follow-?up on:?\s*([^.]+?)(?:\.|Follow-?up note|Note|Occupation|Family|Budget|$)/i)?.[1]?.trim() || null

  const statusText = statusRaw ?? lead?.last_call_status ?? ''
  const connected = /connect/i.test(statusText) || lead?.last_call_status === 'connected'

  const interestKey = (clean(interestRaw) ?? clean(lead?.last_call_interest) ?? '')
    .toLowerCase().replace(/\s+/g, '_')

  // Your Lead = a real temperature (hot/warm/cold) only, and only when connected.
  const leadType = connected && TEMPERATURES.includes(interestKey) ? interestKey : null

  // Your Remarks = a single short label.
  let remarkText: string
  if (connected) {
    if (followUp) remarkText = `Follow-up: ${followUp}`
    else if (TEMPERATURES.includes(interestKey)) remarkText = cap(interestKey)
    else if (interestKey === 'not_interested') remarkText = 'Not Interested'
    else if (interestKey === 'busy') remarkText = 'Busy'
    else if (interestKey === 'channel_partner') remarkText = 'Channel Partner'
    else remarkText = 'Connected'
  } else if (/wrong/i.test(statusText) || lead?.last_call_status === 'wrong_number') {
    remarkText = 'Wrong Number'
  } else if (/call\s*back|callback/i.test(statusText) || lead?.last_call_status === 'callback') {
    remarkText = 'Call Back Later'
  } else if (/no\s*answer/i.test(statusText) || lead?.last_call_status === 'no_answer') {
    remarkText = 'No Answer'
  } else {
    remarkText = '—'
  }

  return { connected, leadType, remark: remarkText }
}
