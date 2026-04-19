'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CampaignLeadDetail } from '@/lib/types'

const TIER_CONFIG: Record<string, { bg: string; text: string; border: string; label: string; emoji: string }> = {
  P1: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Immediate Action', emoji: '🔥' },
  P2: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: 'High Priority', emoji: '🟠' },
  P3: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Warm Follow-up', emoji: '🟡' },
  P4: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Retry', emoji: '🔵' },
  P5: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', label: 'Low Priority', emoji: '⚪' },
  P6: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-300', label: 'No Interest', emoji: '❌' },
  P7: { bg: 'bg-gray-200', text: 'text-gray-400', border: 'border-gray-300', label: 'No Connect', emoji: '🚫' },
}

function QualityBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = Math.round((value / max) * 100)
  const color = value >= 7 ? 'bg-emerald-500' : value >= 4 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#7f7266] font-medium">{label}</span>
        <span className="font-semibold text-[#2a231d]">{value}/{max}</span>
      </div>
      <div className="h-2 bg-[#f0e8dd] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function EntityTag({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null

  const text = String(value).trim()
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return null

  const lower = text.toLowerCase()
  const isYes = lower === 'yes'
  const isNo = lower === 'no'
  return (
    <div className={`px-3 py-2 rounded-xl border text-xs font-medium ${
      isYes ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
      isNo ? 'bg-gray-50 border-gray-200 text-gray-500' :
      'bg-blue-50 border-blue-200 text-blue-700'
    }`}>
      <span className="text-[#7f7266] block text-[10px] uppercase tracking-wider mb-0.5">{label}</span>
      <span>{text}</span>
    </div>
  )
}

function TranscriptViewer({ transcript }: { transcript: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!transcript || transcript === 'transcript not found') {
    return <p className="text-sm text-[#8c7f73] italic">No transcript available</p>
  }

  const lines = transcript.split('\n').filter(l => l.trim())
  const displayLines = expanded ? lines : lines.slice(0, 12)

  return (
    <div className="space-y-2">
      {displayLines.map((line, i) => {
        const trimmed = line.trim()
        const isAgent = trimmed.startsWith('AGENT:') || trimmed.startsWith('Agent:')
        const isUser = trimmed.startsWith('USER:') || trimmed.startsWith('User:')
        const content = trimmed.replace(/^(AGENT|Agent|USER|User):\s*/, '')

        return (
          <div key={i} className={`flex gap-2 items-start ${isAgent ? '' : 'flex-row-reverse'}`}>
            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${
              isAgent ? 'bg-blue-100 text-blue-700' : isUser ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {isAgent ? 'A' : isUser ? 'U' : '?'}
            </div>
            <div className={`px-3 py-2 rounded-2xl text-xs leading-relaxed max-w-[85%] ${
              isAgent ? 'bg-blue-50 text-blue-900 rounded-tl-md' :
              isUser ? 'bg-emerald-50 text-emerald-900 rounded-tr-md' :
              'bg-gray-50 text-gray-700'
            }`}>
              {content || trimmed}
            </div>
          </div>
        )
      })}
      {lines.length > 12 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-[#c86f43] font-semibold hover:underline mt-1"
        >
          {expanded ? '↑ Show less' : `↓ Show all ${lines.length} messages`}
        </button>
      )}
    </div>
  )
}

interface Props {
  lead: CampaignLeadDetail | null
  onClose: () => void
}

export default function CampaignLeadDrawer({ lead, onClose }: Props) {
  const router = useRouter()
  if (!lead) return null

  const tier = TIER_CONFIG[lead.priority_tier] || TIER_CONFIG.P7
  const entities = (lead.extracted_entities || {}) as Record<string, unknown>
  const quality = lead.call_quality || {}
  const hasQuality = Object.keys(quality).length > 0 && (quality.overall_quality ?? 0) > 0
  const ai = lead.ai_analysis as Record<string, unknown> | null
  const evalTag = String(lead.call_eval_tag ?? '').trim().toLowerCase()

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 w-[540px] max-w-[95vw] h-full z-50 bg-[#faf7f3] border-l border-[#e2d6c7] shadow-2xl overflow-y-auto animate-slide-in">
        {/* Header */}
        <div className="sticky top-0 bg-[#faf7f3]/95 backdrop-blur-md border-b border-[#e9dfce] px-6 py-4 z-10">
          <div className="flex items-center justify-between mb-3">
            <button onClick={onClose} className="text-[#8c7f73] hover:text-[#2a231d] p-1 -ml-1 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <button
              onClick={() => router.push(`/leads/${lead.lead_id}`)}
              className="text-xs font-semibold text-[#c86f43] hover:text-[#a65630] px-3 py-1.5 rounded-full border border-[#c86f43]/30 hover:bg-[#c86f43]/5 transition-all"
            >
              Open in CRM →
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#e7cdb9] to-[#f2e3d6] flex items-center justify-center text-[#5a3c2b] font-bold text-lg border border-[#d9bca4]/50">
              {lead.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-[#2a231d] tracking-tight truncate">{lead.name || 'Unknown'}</h3>
              <p className="text-sm text-[#7f7266]">{lead.phone}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${tier.bg} ${tier.text} ${tier.border}`}>
              {tier.emoji} {lead.priority_tier} — {tier.label}
            </span>
            <span className="px-2 py-1 rounded-full text-[10px] font-semibold bg-[#f0e8dd] text-[#5f5348] border border-[#e2d6c7]">
              Score: {lead.priority_score}
            </span>
            <span className={`px-2 py-1 rounded-full text-[10px] font-semibold border ${
              lead.lead_score === 'hot' ? 'bg-red-50 text-red-700 border-red-200' :
              lead.lead_score === 'warm' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-gray-50 text-gray-500 border-gray-200'
            }`}>
              {lead.lead_score?.toUpperCase()}
            </span>
            {lead.call_eval_tag && (
              <span className={`px-2 py-1 rounded-full text-[10px] font-semibold border ${
                evalTag === 'yes' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}>
                Eval: {lead.call_eval_tag}
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Audio Player */}
          {lead.recording_url && (
            <section>
              <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">🎧 Call Recording</h4>
              <div className="bg-white border border-[#eadfce] rounded-2xl p-3">
                <audio controls className="w-full h-10" preload="none">
                  <source src={lead.recording_url} type="audio/mpeg" />
                  Your browser does not support audio.
                </audio>
              </div>
            </section>
          )}

          {/* Call Summary */}
          {lead.summary && (
            <section>
              <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">📋 Call Summary</h4>
              <div className="bg-white border border-[#eadfce] rounded-2xl p-4">
                <p className="text-sm text-[#3a332b] leading-relaxed">{lead.summary}</p>
              </div>
            </section>
          )}

          {/* Quality Scores */}
          {hasQuality && (
            <section>
              <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">📊 Quality Scores</h4>
              <div className="bg-white border border-[#eadfce] rounded-2xl p-4 space-y-3">
                <QualityBar label="Clarity" value={quality.clarity ?? 0} />
                <QualityBar label="Professionalism" value={quality.professionalism ?? 0} />
                <QualityBar label="Problem Resolution" value={quality.problem_resolution ?? 0} />
                <QualityBar label="Overall Quality" value={quality.overall_quality ?? 0} />
              </div>
            </section>
          )}

          {/* Extracted Entities */}
          {Object.keys(entities).length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">🏷️ Extracted Entities</h4>
              <div className="grid grid-cols-2 gap-2">
                <EntityTag label="Config Preference" value={entities.Configuration_Preference} />
                <EntityTag label="Budget Estimate" value={entities.Budget_Estimate} />
                <EntityTag label="Site Visit" value={entities.Site_Visit_Agreed} />
                <EntityTag label="Visit Date" value={entities.Site_Visit_Date} />
                <EntityTag label="Visit Time" value={entities.Site_Visit_Time} />
                <EntityTag label="WhatsApp Follow-up" value={entities.whatsapp_followup} />
                <EntityTag label="Senior Escalation" value={entities['Senior Escalation']} />
                <EntityTag label="Callback Requested" value={entities.call_back_requested} />
              </div>
            </section>
          )}

          {/* Call Metadata */}
          <section>
            <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">📞 Call Details</h4>
            <div className="bg-white border border-[#eadfce] rounded-2xl p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[#8c7f73] text-xs">Attempt</span>
                  <p className="font-semibold text-[#2a231d]">#{lead.attempt_number}</p>
                </div>
                <div>
                  <span className="text-[#8c7f73] text-xs">Retries</span>
                  <p className="font-semibold text-[#2a231d]">{lead.num_of_retries}</p>
                </div>
                {lead.call_dialing_at && (
                  <div>
                    <span className="text-[#8c7f73] text-xs">Dialing At</span>
                    <p className="font-semibold text-[#2a231d] text-xs">{lead.call_dialing_at}</p>
                  </div>
                )}
                {lead.user_picked_up && (
                  <div>
                    <span className="text-[#8c7f73] text-xs">User Picked Up</span>
                    <p className="font-semibold text-[#2a231d] text-xs">{lead.user_picked_up}</p>
                  </div>
                )}
                <div>
                  <span className="text-[#8c7f73] text-xs">Stage</span>
                  <p className="font-semibold text-[#2a231d] capitalize">{lead.stage?.replace(/_/g, ' ')}</p>
                </div>
                {lead.assigned_agent_name && (
                  <div>
                    <span className="text-[#8c7f73] text-xs">Assigned To</span>
                    <p className="font-semibold text-[#2a231d]">{lead.assigned_agent_name}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* AI Analysis */}
          {ai && Object.keys(ai).length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">🤖 AI Analysis</h4>
              <div className="bg-white border border-[#eadfce] rounded-2xl p-4 space-y-3">
                {ai.engagement_level && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#8c7f73]">Engagement:</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      ai.engagement_level === 'high' ? 'bg-emerald-100 text-emerald-700' :
                      ai.engagement_level === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>{String(ai.engagement_level).toUpperCase()}</span>
                  </div>
                )}
                {ai.close_probability !== undefined && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#7f7266]">Close Probability</span>
                      <span className="font-semibold text-[#2a231d]">{String(ai.close_probability)}%</span>
                    </div>
                    <div className="h-2 bg-[#f0e8dd] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#c86f43] to-[#e8a06c] transition-all duration-700" style={{ width: `${Number(ai.close_probability)}%` }} />
                    </div>
                  </div>
                )}
                {Array.isArray(ai.intent_signals) && (ai.intent_signals as string[]).length > 0 && (
                  <div>
                    <span className="text-xs text-[#8c7f73] block mb-1">Intent Signals</span>
                    <div className="flex flex-wrap gap-1">
                      {(ai.intent_signals as string[]).map((s, i) => (
                        <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded-full border border-blue-200 font-medium">{s.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(ai.objections) && (ai.objections as string[]).length > 0 && (
                  <div>
                    <span className="text-xs text-[#8c7f73] block mb-1">Objections</span>
                    <div className="flex flex-wrap gap-1">
                      {(ai.objections as string[]).map((s, i) => (
                        <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 text-[10px] rounded-full border border-red-200 font-medium">{s.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </div>
                )}
                {ai.suggested_next_action && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <span className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold">Recommended Action</span>
                    <p className="text-sm text-amber-900 mt-1">{String(ai.suggested_next_action)}</p>
                  </div>
                )}
                {ai.lead_quality_assessment && (
                  <p className="text-xs text-[#5f5348] italic border-l-2 border-[#c86f43] pl-3">{String(ai.lead_quality_assessment)}</p>
                )}
              </div>
            </section>
          )}

          {/* Transcript */}
          {lead.transcript && lead.transcript !== 'transcript not found' && (
            <section>
              <h4 className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold mb-2">💬 Transcript</h4>
              <div className="bg-white border border-[#eadfce] rounded-2xl p-4">
                <TranscriptViewer transcript={lead.transcript} />
              </div>
            </section>
          )}
        </div>

        <style jsx>{`
          @keyframes slide-in {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
          .animate-slide-in {
            animation: slide-in 0.3s ease-out;
          }
        `}</style>
      </div>
    </>
  )
}
