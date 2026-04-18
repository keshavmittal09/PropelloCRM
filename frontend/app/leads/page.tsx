'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLeadsPaginated } from '@/hooks/useQueries'
import Sidebar from '@/components/shared/Sidebar'
import { ScoreBadge, SourceTag, DaysInStage } from '@/components/shared/Badges'
import { formatBudget, formatDate, stageConfig } from '@/lib/utils'
import { leadsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { LeadStage, LeadScore } from '@/lib/types'

const STAGES: LeadStage[] = ['new', 'contacted', 'site_visit_scheduled', 'site_visit_done', 'negotiation', 'won', 'lost', 'nurture']
const SCORES: LeadScore[] = ['hot', 'warm', 'cold']
const SOURCES = ['priya_ai', 'website', 'facebook_ads', 'google_ads', '99acres', 'magicbricks', 'walk_in', 'referral', 'email_campaign', 'manual', 'campaign']
const PAGE_SIZE = 25

export default function LeadsPage() {
  const router = useRouter()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('')
  const [score, setScore] = useState('')
  const [source, setSource] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [page, setPage] = useState(1)
  const [showNewLead, setShowNewLead] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStage(params.get('stage') ?? '')
    setScore(params.get('lead_score') ?? '')
    setSource(params.get('source') ?? '')
    setCampaignId(params.get('campaign_id') ?? '')
  }, [])

  useEffect(() => {
    setPage(1)
  }, [stage, score, source, campaignId, search])

  const { data: leadsPage, isLoading } = useLeadsPaginated({
    ...(stage && { stage }),
    ...(score && { lead_score: score }),
    ...(source && { source }),
    ...(campaignId && { campaign_id: campaignId }),
    ...(search && { search }),
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

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900">All Leads</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalLeads} leads found {totalLeads > 0 ? `· Showing ${visibleStart}-${visibleEnd}` : ''}
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

        {/* Filters */}
        <div className="px-8 py-4 bg-white border-b border-gray-100 flex gap-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-56" />

          <select value={stage} onChange={e => setStage(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All stages</option>
            {STAGES.map(s => <option key={s} value={s}>{stageConfig[s].label}</option>)}
          </select>

          <select value={score} onChange={e => setScore(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All scores</option>
            {SCORES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>

          <select value={source} onChange={e => setSource(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">All sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>

          {(stage || score || source || search || campaignId) && (
            <button onClick={() => { setStage(''); setScore(''); setSource(''); setCampaignId(''); setSearch('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-red-600 border border-gray-200 rounded-lg hover:border-red-200">
              Clear filters
            </button>
          )}
        </div>

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
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Contact', 'Score', 'Stage', 'Budget', 'Source', 'Days', 'Agent', 'Created'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map(lead => (
                      <tr key={lead.id}
                        className="border-b border-gray-50 hover:bg-indigo-50/30 cursor-pointer transition-colors"
                        onClick={() => router.push(`/leads/${lead.id}`)}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-900">{lead.contact?.name}</p>
                          <p className="text-xs text-gray-400">{lead.contact?.phone}</p>
                        </td>
                        <td className="px-4 py-3"><ScoreBadge score={lead.lead_score} /></td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-sm text-gray-700">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stageConfig[lead.stage].color }} />
                            {stageConfig[lead.stage].label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatBudget(lead.budget_min, lead.budget_max)}</td>
                        <td className="px-4 py-3"><SourceTag source={lead.source} /></td>
                        <td className="px-4 py-3"><DaysInStage days={lead.days_in_stage} /></td>
                        <td className="px-4 py-3 text-sm text-gray-500">{lead.assigned_agent?.name?.split(' ')[0] ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{formatDate(lead.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-500">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm disabled:opacity-50"
                  >
                    Prev
                  </button>

                  {startPage > 1 && (
                    <>
                      <button
                        onClick={() => setPage(1)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm"
                      >
                        1
                      </button>
                      {startPage > 2 && <span className="px-1 text-gray-400">...</span>}
                    </>
                  )}

                  {Array.from({ length: endPage - startPage + 1 }, (_, idx) => startPage + idx).map((pageNum) => (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${
                        pageNum === page
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      {pageNum}
                    </button>
                  ))}

                  {endPage < totalPages && (
                    <>
                      {endPage < totalPages - 1 && <span className="px-1 text-gray-400">...</span>}
                      <button
                        onClick={() => setPage(totalPages)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {showNewLead && <NewLeadModal onClose={() => setShowNewLead(false)} onCreated={() => { setShowNewLead(false); qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['leads-paginated'] }) }} />}
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
