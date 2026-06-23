'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLeadsPaginated } from '@/hooks/useQueries'
import Sidebar from '@/components/shared/Sidebar'
import { ScoreBadge, SourceTag } from '@/components/shared/Badges'
import { formatBudget, formatDate, stageConfig } from '@/lib/utils'
import { leadsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { LeadStage, LeadScore } from '@/lib/types'
import { getWASupabase } from '@/lib/waSupabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MobileLeadCard } from '@/components/mobile/MobileLeadCard'
import { MobileHeader } from '@/components/mobile/MobileHeader'

const WA_LABEL_STYLE: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-yellow-100 text-yellow-700',
  COLD: 'bg-blue-100 text-blue-700',
}

const STAGES: LeadStage[] = ['new', 'contacted', 'site_visit_scheduled', 'site_visit_done', 'negotiation', 'won', 'lost', 'nurture']
const SCORES: LeadScore[] = ['hot', 'warm', 'cold']
const SOURCES = ['priya_ai', 'website', 'facebook_ads', 'google_ads', '99acres', 'magicbricks', 'walk_in', 'referral', 'email_campaign', 'manual', 'campaign']
const SENTIMENTS = ['positive', 'neutral', 'negative']
const WA_STATUSES = ['not_sent', 'sent', 'delivered', 'read', 'replied']
const SCORE_RANGES = [
  { label: '0–20', min: 0, max: 20 },
  { label: '21–40', min: 21, max: 40 },
  { label: '41–60', min: 41, max: 60 },
  { label: '61–80', min: 61, max: 80 },
  { label: '81–100', min: 81, max: 100 },
]
const DATE_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
]
const PAGE_SIZE = 25


export default function LeadsPage() {
  const router = useRouter()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('')
  const [score, setScore] = useState('')
  const [source, setSource] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [sentiment, setSentiment] = useState('')
  const [waStatus, setWaStatus] = useState('')
  const [assigned, setAssigned] = useState('')
  const [retry, setRetry] = useState('')
  const [scoreRange, setScoreRange] = useState<{ min?: number; max?: number }>({})
  const [dateFilter, setDateFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [showNewLead, setShowNewLead] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStage(params.get('stage') ?? '')
    setScore(params.get('lead_score') ?? '')
    setSource(params.get('source') ?? '')
    setCampaignId(params.get('campaign_id') ?? '')
  }, [])

  useEffect(() => { setPage(1) }, [stage, score, source, campaignId, search, sentiment, waStatus, assigned, retry, scoreRange, dateFilter, dateFrom, dateTo])

  const [waSearchResults, setWaSearchResults] = useState<any[]>([])

  // Search WA Supabase when search term changes
  useEffect(() => {
    if (!search.trim()) { setWaSearchResults([]); return }
    const q = search.trim()
    try {
      getWASupabase()
        .from('leads')
        .select('id,phone,name,score,label,intent,last_message,updated_at')
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(20)
        .then(({ data }) => setWaSearchResults(data ?? []))
    } catch { setWaSearchResults([]) }
  }, [search])

  const { data: leadsPage, isLoading, isError, error } = useLeadsPaginated({
    ...(stage && { stage }),
    ...(score && { lead_score: score }),
    ...(source && { source }),
    ...(campaignId && { campaign_id: campaignId }),
    ...(search && { search }),
    ...(sentiment && { sentiment }),
    ...(waStatus && { whatsapp_status: waStatus }),
    ...(assigned && { assigned }),
    ...(retry && { retry }),
    ...(scoreRange.min !== undefined && { min_score: scoreRange.min }),
    ...(scoreRange.max !== undefined && { max_score: scoreRange.max }),
    ...(dateFilter && { date_filter: dateFilter }),
    ...(dateFilter === 'custom' && dateFrom && { date_from: dateFrom }),
    ...(dateFilter === 'custom' && dateTo && { date_to: dateTo }),
    page,
    page_size: PAGE_SIZE,
  })

  const leads = leadsPage?.items ?? []
  const totalLeads = leadsPage?.total ?? 0

  const totalPages = Math.max(leadsPage?.total_pages ?? 1, 1)
  const visibleStart = totalLeads === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const visibleEnd = totalLeads === 0 ? 0 : Math.min(page * PAGE_SIZE, totalLeads)
  const startPage = Math.max(1, Math.min(page - 2, totalPages - 4))
  const endPage = Math.min(totalPages, startPage + 4)

  const hasActiveFilters = !!(stage || score || source || search || campaignId || sentiment || waStatus || assigned || retry || scoreRange.min !== undefined || dateFilter)

  const clearFilters = () => {
    setStage(''); setScore(''); setSource(''); setCampaignId(''); setSearch('')
    setSentiment(''); setWaStatus(''); setAssigned(''); setRetry('')
    setScoreRange({}); setDateFilter(''); setDateFrom(''); setDateTo('')
  }

  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="min-h-screen bg-[#f8f4ef] pb-24">
        <MobileHeader title="Leads" subtitle={`${totalLeads} total`} showBack={false} />
        <div className="sticky top-[60px] z-10 bg-white border-b border-[#e8ddcf] px-4 py-2.5">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search name or phone…"
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#e8ddcf] text-sm outline-none focus:border-[#c86f43] bg-[#faf7f2]"
          />
        </div>
        <div className="p-3 space-y-2.5">
          {isLoading ? (
            [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-2xl h-24 animate-pulse border border-[#e8ddcf]" />
            ))
          ) : leads.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">📭</p>
              <p className="text-[#8f8378] font-medium">No leads found</p>
            </div>
          ) : (
            leads.map((lead) => <MobileLeadCard key={lead.id} lead={lead} />)
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 py-5">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 rounded-xl border border-[#e8ddcf] bg-white text-sm font-semibold text-[#5f5348] disabled:opacity-40">
              ← Prev
            </button>
            <span className="text-sm text-[#8f8378] font-medium">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-4 py-2 rounded-xl border border-[#e8ddcf] bg-white text-sm font-semibold text-[#5f5348] disabled:opacity-40">
              Next →
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900">All Leads</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalLeads} leads found {totalLeads > 0 ? `· Showing ${visibleStart}–${visibleEnd}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/leads/board')}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">
              Board view
            </button>
            <button onClick={() => setShowNewLead(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700">
              + New lead
            </button>
          </div>
        </div>

        {/* Primary Filters */}
        <div className="px-8 py-4 bg-white border-b border-gray-100 flex gap-3 flex-wrap items-center">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-52" />

          <select value={stage} onChange={e => setStage(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All stages</option>
            {STAGES.map(s => <option key={s} value={s}>{stageConfig[s]?.label ?? s}</option>)}
          </select>

          <select value={score} onChange={e => setScore(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All categories</option>
            {SCORES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>

          <select value={source} onChange={e => setSource(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>

          <button
            onClick={() => setShowAdvanced(v => !v)}
            className={`px-3 py-2 text-sm border rounded-lg font-medium transition-colors ${showAdvanced ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {showAdvanced ? 'Hide filters ▲' : 'More filters ▼'}
          </button>

          {hasActiveFilters && (
            <button onClick={clearFilters}
              className="px-3 py-2 text-sm text-gray-500 hover:text-red-600 border border-gray-200 rounded-lg hover:border-red-200">
              Clear all
            </button>
          )}
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="px-8 py-4 bg-indigo-50/40 border-b border-gray-100 flex gap-3 flex-wrap items-end">
            {/* Sentiment */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Sentiment</p>
              <select value={sentiment} onChange={e => setSentiment(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">Any</option>
                {SENTIMENTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>

            {/* WhatsApp */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">WhatsApp Status</p>
              <select value={waStatus} onChange={e => setWaStatus(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">Any</option>
                {WA_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>

            {/* Assignment */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Assignment</p>
              <select value={assigned} onChange={e => setAssigned(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">All</option>
                <option value="assigned">Assigned</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </div>

            {/* Retry */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Retry Status</p>
              <select value={retry} onChange={e => setRetry(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">All</option>
                <option value="retry_1">Retry 1</option>
                <option value="retry_2">Retry 2</option>
                <option value="retry_3">Retry 3</option>
                <option value="max_reached">Max Retry Reached</option>
              </select>
            </div>

            {/* Score Range */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">AI Score Range</p>
              <select
                value={scoreRange.min !== undefined ? `${scoreRange.min}-${scoreRange.max}` : ''}
                onChange={e => {
                  if (!e.target.value) { setScoreRange({}); return }
                  const found = SCORE_RANGES.find(r => `${r.min}-${r.max}` === e.target.value)
                  if (found) setScoreRange({ min: found.min, max: found.max })
                }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">Any score</option>
                {SCORE_RANGES.map(r => <option key={r.label} value={`${r.min}-${r.max}`}>{r.label}</option>)}
              </select>
            </div>

            {/* Date Filter */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Date</p>
              <select value={dateFilter} onChange={e => { setDateFilter(e.target.value); setDateFrom(''); setDateTo('') }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">Any time</option>
                {DATE_FILTERS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            {dateFilter === 'custom' && (
              <>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">From</p>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">To</p>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                </div>
              </>
            )}
          </div>
        )}

        {/* API Error Banner */}
        {isError && (
          <div className="mx-8 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
            <span className="text-base">⚠️</span>
            <div>
              <p className="font-semibold">Could not load leads — backend unreachable</p>
              <p className="text-xs text-red-500 mt-0.5">{(error as any)?.message ?? 'Network error. Check that NEXT_PUBLIC_API_URL is set in Vercel and the backend on Render is running.'}</p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="px-8 py-6">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
            </div>
          ) : !leads.length ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-lg">No leads found</p>
              <p className="text-gray-300 text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      {['Contact', 'Category', 'Stage', 'Budget', 'Source', 'Next Follow-up'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map(lead => (
                      <tr key={lead.id}
                        className="border-b border-gray-50 hover:bg-indigo-50/30 cursor-pointer transition-colors"
                        onClick={() => router.push(`/leads/${lead.id}`)}>

                        {/* Contact */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-900">{lead.contact?.name}</p>
                          <p className="text-xs text-gray-400">{lead.contact?.phone}</p>
                        </td>

                        {/* Category (Hot/Warm/Cold) */}
                        <td className="px-4 py-3"><ScoreBadge score={lead.lead_score} /></td>

                        {/* Stage */}
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-sm text-gray-700">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stageConfig[lead.stage]?.color }} />
                            {stageConfig[lead.stage]?.label ?? lead.stage}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatBudget(lead.budget_min, lead.budget_max)}</td>
                        <td className="px-4 py-3"><SourceTag source={lead.source} /></td>

                        {/* Next Follow-up */}
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {lead.next_followup_date ? formatDate(lead.next_followup_date) : (lead.next_call_date ? `📞 ${formatDate(lead.next_call_date)}` : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm disabled:opacity-50">Prev</button>

                  {startPage > 1 && (
                    <>
                      <button onClick={() => setPage(1)} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm">1</button>
                      {startPage > 2 && <span className="px-1 text-gray-400">...</span>}
                    </>
                  )}

                  {Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map(n => (
                    <button key={n} onClick={() => setPage(n)}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${n === page ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                      {n}
                    </button>
                  ))}

                  {endPage < totalPages && (
                    <>
                      {endPage < totalPages - 1 && <span className="px-1 text-gray-400">...</span>}
                      <button onClick={() => setPage(totalPages)} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm">{totalPages}</button>
                    </>
                  )}

                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp Bot Leads — shown when search finds results in WA Supabase */}
          {search.trim() && waSearchResults.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full">💬 WhatsApp Bot Leads ({waSearchResults.length})</span>
                <span className="text-xs text-gray-400">These leads are in your WhatsApp bot but not yet in the CRM</span>
              </div>
              <div className="bg-white border border-green-100 rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-green-50/50">
                      {['Name', 'Phone', 'WA Label', 'Score', 'Intent', 'Last Message', 'Last Active'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {waSearchResults.map(w => (
                      <tr key={w.id} className="border-b border-gray-50 hover:bg-green-50/20 cursor-pointer"
                        onClick={() => router.push(`/whatsapp?phone=${w.phone}`)}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-900">{w.name}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{w.phone}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${WA_LABEL_STYLE[w.label] ?? 'bg-gray-100 text-gray-600'}`}>{w.label}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{w.score} / 10</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{w.intent ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{w.last_message ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{w.updated_at ? new Date(w.updated_at).toLocaleDateString('en-IN') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {showNewLead && (
          <NewLeadModal
            onClose={() => setShowNewLead(false)}
            onCreated={() => { setShowNewLead(false); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['leads-paginated'] }) }}
          />
        )}
      </main>
    </div>
  )
}

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', source: 'manual', lead_score: 'warm', budget_min: '', budget_max: '', location_preference: '', property_type_interest: '' })
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!form.name || !form.phone) return toast.error('Name and phone are required')
    setLoading(true)
    try {
      await leadsApi.create({ ...form, budget_min: form.budget_min ? Number(form.budget_min) : null, budget_max: form.budget_max ? Number(form.budget_max) : null })
      toast.success('Lead created!')
      onCreated()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to create lead')
    } finally { setLoading(false) }
  }

  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900">Add new lead</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="space-y-3">
          {field('Full name *', 'name', 'text', 'Rahul Sharma')}
          {field('Phone *', 'phone', 'tel', '9876543210')}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lead score</label>
            <select value={form.lead_score} onChange={e => setForm(f => ({ ...f, lead_score: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {SCORES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('Budget min (₹)', 'budget_min', 'number', '5000000')}
            {field('Budget max (₹)', 'budget_max', 'number', '10000000')}
          </div>
          {field('Location preference', 'location_preference', 'text', 'Gurgaon Sector 56')}
          {field('Property type', 'property_type_interest', 'text', 'apartment')}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-indigo-700">
            {loading ? 'Creating...' : 'Create lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
