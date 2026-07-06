'use client'
import Link from 'next/link'
import type { Lead } from '@/lib/types'

interface Props {
  lead: Lead
}

const SCORE_COLORS = {
  hot: { border: 'border-red-500', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  warm: { border: 'border-amber-400', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  cold: { border: 'border-blue-400', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
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

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

export function MobileLeadCard({ lead }: Props) {
  const colors = SCORE_COLORS[lead.lead_score as keyof typeof SCORE_COLORS] ?? SCORE_COLORS.warm
  const stageLabel = STAGE_LABELS[lead.stage] ?? lead.stage
  const profileName = typeof lead.master_profile?.full_name === 'string' ? lead.master_profile.full_name : null
  const name = lead.contact?.name ?? profileName ?? 'Lead'
  const phone = lead.contact?.phone ?? ''
  const callUrl = phone ? `tel:${phone}` : null

  return (
    <Link
      href={`/leads/${lead.id}`}
      className={`block bg-white rounded-2xl border-l-4 ${colors.border} border border-[#e8ddcf] p-4 shadow-sm active:bg-[#faf8f5] transition-colors`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-[#1f1914] truncate">{name}</p>
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full capitalize ${colors.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
              {lead.lead_score}
            </span>
          </div>
          {phone && (
            <p className="text-xs text-[#8f8378] mt-0.5 font-mono">{phone}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {lead.last_call_interest && ['hot', 'warm', 'cold'].includes(lead.last_call_interest.toLowerCase()) && (
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${SCORE_COLORS[lead.last_call_interest.toLowerCase() as keyof typeof SCORE_COLORS]?.badge ?? 'bg-gray-100 text-gray-600'}`}>
                Your rating: {lead.last_call_interest}
              </span>
            )}
            <span className="text-[11px] bg-[#f5f0e8] text-[#6e6357] px-2 py-0.5 rounded-full">
              {stageLabel}
            </span>
            {lead.property_type_interest && (
              <span className="text-[11px] bg-[#f5f0e8] text-[#6e6357] px-2 py-0.5 rounded-full">
                {lead.property_type_interest}
              </span>
            )}
          </div>
          {lead.last_contacted_at && (
            <p className="text-[11px] text-[#a29587] mt-1.5">Last contact: {timeAgo(lead.last_contacted_at)}</p>
          )}
        </div>

        {callUrl && (
          <a
            href={callUrl}
            onClick={e => e.stopPropagation()}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-[#f0f7ff] border border-blue-200 flex items-center justify-center text-blue-600 active:bg-blue-50"
          >
            📞
          </a>
        )}
      </div>
    </Link>
  )
}
