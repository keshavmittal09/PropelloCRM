'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import CampaignLeadDrawer from '@/components/leads/CampaignLeadDrawer'
import { useCampaign, useCampaignAnalytics, useCampaignLeadsDetail, useAgentAssignments } from '@/hooks/useQueries'
import { authApi, campaignsApi } from '@/lib/api'
import type { Agent, CampaignLeadDetail, CampaignInsight } from '@/lib/types'
import { useAuthStore } from '@/store/useAuthStore'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Priority Queue', 'Insights', 'Agent Assignment', 'AI Analysis'] as const
type Tab = typeof TABS[number]

const TIER_CONFIG: Record<string, { bg: string; text: string; border: string; row: string; emoji: string }> = {
  P1: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', row: 'bg-red-50/50', emoji: '🔥' },
  P2: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', row: 'bg-orange-50/40', emoji: '🟠' },
  P3: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', row: 'bg-amber-50/30', emoji: '🟡' },
  P4: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', row: 'bg-blue-50/30', emoji: '🔵' },
  P5: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', row: '', emoji: '⚪' },
  P6: { bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-300', row: '', emoji: '❌' },
  P7: { bg: 'bg-gray-200', text: 'text-gray-400', border: 'border-gray-300', row: 'bg-gray-50/50', emoji: '🚫' },
}

const PIE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#9ca3af', '#6b7280', '#d1d5db']
const SEVERITY_COLORS = { critical: 'border-red-300 bg-red-50', warning: 'border-amber-300 bg-amber-50', info: 'border-blue-200 bg-blue-50' }
const SEVERITY_BADGE = { critical: 'bg-red-100 text-red-700', warning: 'bg-amber-100 text-amber-700', info: 'bg-blue-100 text-blue-700' }

// ─── HELPER COMPONENTS ──────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 border transition-all hover:shadow-md ${accent ? 'bg-[#2a231d] border-[#3e342a] text-white' : 'bg-white border-[#eadfce]'}`}>
      <p className={`text-[10px] uppercase tracking-[0.14em] font-semibold ${accent ? 'text-[#b8a895]' : 'text-[#8c7f73]'}`}>{label}</p>
      <p className={`text-2xl font-bold mt-1 tracking-tight ${accent ? 'text-white' : 'text-[#2a231d]'}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-0.5 ${accent ? 'text-[#a89481]' : 'text-[#8c7f73]'}`}>{sub}</p>}
    </div>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.P7
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>{cfg.emoji} {tier}</span>
}

function ScoreBadgeSmall({ score }: { score: string }) {
  const colors: Record<string, string> = {
    hot: 'bg-red-100 text-red-700 border-red-200',
    warm: 'bg-amber-100 text-amber-700 border-amber-200',
    cold: 'bg-gray-100 text-gray-500 border-gray-200',
  }
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colors[score] || colors.cold}`}>{score?.toUpperCase()}</span>
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map(i => <div key={i} className="h-24 bg-[#f0e8dd] rounded-2xl" />)}
    </div>
  )
}

// ─── MAIN DASHBOARD ─────────────────────────────────────────────────────────

export default function CampaignDashboardPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { agent: currentAgent } = useAuthStore()
  const campaignId = params?.id ?? ''

  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const [tierFilter, setTierFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLead, setSelectedLead] = useState<CampaignLeadDetail | null>(null)
  const [aiRunning, setAiRunning] = useState(false)
  const [aiRunMessage, setAiRunMessage] = useState<string | null>(null)
  const [removingProject, setRemovingProject] = useState(false)
  const [removingCampaign, setRemovingCampaign] = useState(false)
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([])
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])

  const { data: campaign, refetch: refetchCampaign } = useCampaign(campaignId)
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    error: analyticsErrorObj,
  } = useCampaignAnalytics(campaignId)
  const { data: leads, isLoading: leadsLoading, refetch: refetchLeads } = useCampaignLeadsDetail(
    campaignId, { tier: tierFilter || undefined, search: searchQuery || undefined }
  )
  const { data: assignments, refetch: refetchAssignments } = useAgentAssignments(campaignId, selectedAgentIds)
  const canManageProject = ['admin', 'manager'].includes(currentAgent?.role || '')
  const canRemoveCampaign = ['admin', 'manager'].includes(currentAgent?.role || '')

  useEffect(() => {
    authApi.listAgents()
      .then((data) => {
        const active = (data || []).filter((a) => a.is_active)
        setAvailableAgents(active)
        const defaults = active.filter((a) => a.role === 'call_agent').map((a) => a.id)
        setSelectedAgentIds(defaults)
      })
      .catch(() => {
        setAvailableAgents([])
        setSelectedAgentIds([])
      })
  }, [])

  const tierData = useMemo(() => {
    if (!analytics?.tier_distribution) return []
    return Object.entries(analytics.tier_distribution)
      .map(([tier, count]) => ({ name: tier, value: count as number }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [analytics])

  const qualityRadar = useMemo(() => {
    if (!analytics) return []
    return [
      { subject: 'Clarity', A: analytics.avg_clarity },
      { subject: 'Professional', A: analytics.avg_professionalism },
      { subject: 'Resolution', A: analytics.avg_problem_resolution },
      { subject: 'Overall', A: analytics.avg_overall_quality },
    ]
  }, [analytics])

  const handleRunAi = async () => {
    setAiRunning(true)
    setAiRunMessage(null)
    try {
      const result = await campaignsApi.triggerAiAnalysis(campaignId)
      const resultMessage = String(result?.message || '').trim()
      const messageLower = resultMessage.toLowerCase()

      if (messageLower.includes('not configured') || messageLower.includes('disabled')) {
        setAiRunMessage(resultMessage)
        toast.error(resultMessage)
        return
      }

      if ((result?.analyzed ?? 0) <= 0) {
        const fallbackMessage = resultMessage || `No calls analyzed. Skipped: ${result?.skipped ?? 0}`
        setAiRunMessage(fallbackMessage)
        toast(fallbackMessage)
      } else {
        const successMessage = resultMessage || `AI analysis complete: ${result.analyzed} calls analyzed`
        setAiRunMessage(successMessage)
        toast.success(successMessage)
      }

      refetchLeads()
    } catch (e: any) {
      setAiRunMessage(null)
      toast.error(e?.response?.data?.detail || e?.response?.data?.message || 'AI analysis failed')
    } finally {
      setAiRunning(false)
    }
  }

  const handleAssignAgents = async () => {
    try {
      const result = await campaignsApi.executeAgentAssignment(campaignId, selectedAgentIds)
      toast.success(`Assigned ${result.assigned} leads to ${result.agents} agents`)
      refetchAssignments()
      refetchLeads()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Assignment failed')
    }
  }

  const handleRemoveProject = async () => {
    if (!campaignId) return
    setRemovingProject(true)
    try {
      await campaignsApi.removeProject(campaignId)
      toast.success('Project link removed from campaign')
      await refetchCampaign()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Unable to remove project link')
    } finally {
      setRemovingProject(false)
    }
  }

  const handleRemoveCampaign = async () => {
    if (!campaignId || !campaign?.name) return
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Remove campaign \"${campaign.name}\"? This action cannot be undone.`)
      if (!confirmed) return
    }

    setRemovingCampaign(true)
    try {
      await campaignsApi.deleteCampaign(campaignId)
      toast.success('Campaign removed')
      router.push('/campaigns')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Unable to remove campaign')
    } finally {
      setRemovingCampaign(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {/* Page Header */}
        <div className="px-8 pt-8 pb-4">
          <button onClick={() => router.push(`/campaigns/${campaignId}`)} className="text-xs text-[#8c7f73] hover:text-[#c86f43] mb-2 inline-flex items-center gap-1 transition-colors">
            ← Back to campaign
          </button>
          <h1 className="text-3xl font-semibold text-[#2a231d] tracking-tight">
            {analytics?.campaign_name || 'Campaign Dashboard'}
          </h1>
          <p className="text-sm text-[#7f7266] mt-1">Call Campaign Analytics & Priority Queue</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {campaign?.project_name ? (
              <span className="inline-flex items-center rounded-full border border-[#e4d6c6] bg-white px-3 py-1 text-xs font-semibold text-[#5f5348]">
                Linked project: {campaign.project_name}
              </span>
            ) : null}
            {canRemoveCampaign ? (
              <button
                onClick={handleRemoveCampaign}
                disabled={removingCampaign}
                className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
              >
                {removingCampaign ? 'Removing...' : 'Remove Campaign'}
              </button>
            ) : null}
            {canManageProject && campaign?.project_id ? (
              <button
                onClick={handleRemoveProject}
                disabled={removingProject}
                className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
              >
                {removingProject ? 'Removing...' : 'Remove Project Link'}
              </button>
            ) : null}
          </div>
        </div>

        {/* Tabs */}
        <div className="px-8 mb-6">
          <div className="flex gap-1 bg-[#eee8e0] p-1 rounded-full w-fit">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTab === tab ? 'bg-[#2a231d] text-white shadow-md' : 'text-[#7f7266] hover:text-[#2a231d]'
                }`}
              >{tab}</button>
            ))}
          </div>
        </div>

        <div className="px-8 pb-10">
          {analyticsLoading ? <Skeleton /> : analyticsError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Unable to load campaign analytics. {String((analyticsErrorObj as any)?.message || 'Please check backend logs and retry.')}
            </div>
          ) : (
            <>
              {activeTab === 'Overview' && analytics && <OverviewTab analytics={analytics} tierData={tierData} qualityRadar={qualityRadar} />}
              {activeTab === 'Priority Queue' && (
                <PriorityQueueTab
                  leads={leads || []}
                  loading={leadsLoading}
                  tierFilter={tierFilter}
                  searchQuery={searchQuery}
                  onTierChange={setTierFilter}
                  onSearchChange={setSearchQuery}
                  onSelectLead={setSelectedLead}
                />
              )}
              {activeTab === 'Insights' && analytics && <InsightsTab insights={analytics.insights} />}
              {activeTab === 'Agent Assignment' && (
                <AgentAssignmentTab
                  assignments={assignments || []}
                  availableAgents={availableAgents}
                  selectedAgentIds={selectedAgentIds}
                  onSelectedAgentIdsChange={setSelectedAgentIds}
                  onAssign={handleAssignAgents}
                  onSelectLead={setSelectedLead}
                />
              )}
              {activeTab === 'AI Analysis' && (
                <AiAnalysisTab
                  leads={leads || []}
                  loading={leadsLoading}
                  running={aiRunning}
                  lastRunMessage={aiRunMessage}
                  onRunAi={handleRunAi}
                  onSelectLead={setSelectedLead}
                />
              )}
            </>
          )}
        </div>

        {/* Lead Detail Drawer */}
        <CampaignLeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />
      </main>
    </div>
  )
}


// ─── TAB: OVERVIEW ──────────────────────────────────────────────────────────

function OverviewTab({ analytics, tierData, qualityRadar }: {
  analytics: NonNullable<ReturnType<typeof useCampaignAnalytics>['data']>
  tierData: { name: string; value: number }[]
  qualityRadar: { subject: string; A: number }[]
}) {
  const outcomeData = [
    { name: 'Connected', value: analytics.total_connected },
    { name: 'No Connect', value: analytics.total_dialed - analytics.total_connected },
  ]

  return (
    <div className="space-y-6 crm-page-enter">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 crm-stagger">
        <KpiCard label="Total Dialed" value={analytics.total_dialed} />
        <KpiCard label="Connected" value={analytics.total_connected} sub={`${analytics.connection_rate}%`} accent />
        <KpiCard label="Eval Yes" value={analytics.eval_yes} />
        <KpiCard label="Eval No" value={analytics.eval_no} />
        <KpiCard label="🔥 Hot" value={analytics.hot_count} />
        <KpiCard label="🟡 Warm" value={analytics.warm_count} />
        <KpiCard label="❄️ Cold" value={analytics.cold_count} />
        <KpiCard label="Avg Quality" value={`${analytics.avg_overall_quality}/10`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Tier Distribution */}
        <div className="bg-white border border-[#eadfce] rounded-3xl p-6">
          <h3 className="font-semibold text-[#2a231d] mb-4">Priority Tier Distribution</h3>
          {tierData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={tierData} barCategoryGap="20%">
                <XAxis dataKey="name" tick={{ fill: '#7f7266', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#7f7266', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ border: '1px solid #eadfce', borderRadius: '12px', fontSize: '13px' }} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {tierData.map((entry, i) => (
                    <Cell key={entry.name} fill={PIE_COLORS[i] || '#9ca3af'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-[#8c7f73]">No data</p>}
        </div>

        {/* Outcome Pie */}
        <div className="bg-white border border-[#eadfce] rounded-3xl p-6">
          <h3 className="font-semibold text-[#2a231d] mb-4">Connection Outcome</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={outcomeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4}>
                <Cell fill="#c86f43" />
                <Cell fill="#e2d6c7" />
              </Pie>
              <Tooltip contentStyle={{ border: '1px solid #eadfce', borderRadius: '12px', fontSize: '13px' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 mt-2 text-sm">
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#c86f43]" /> Connected ({analytics.total_connected})</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#e2d6c7]" /> No Connect ({analytics.total_dialed - analytics.total_connected})</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Quality Radar */}
        <div className="bg-white border border-[#eadfce] rounded-3xl p-6">
          <h3 className="font-semibold text-[#2a231d] mb-4">Quality Dimensions</h3>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={qualityRadar} outerRadius={80}>
              <PolarGrid stroke="#e9dfce" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#7f7266', fontSize: 12 }} />
              <PolarRadiusAxis domain={[0, 10]} tick={{ fill: '#8c7f73', fontSize: 10 }} />
              <Radar name="Score" dataKey="A" stroke="#c86f43" fill="#c86f43" fillOpacity={0.25} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Attempt Connection Rates */}
        <div className="bg-white border border-[#eadfce] rounded-3xl p-6">
          <h3 className="font-semibold text-[#2a231d] mb-4">Connection Rate by Attempt</h3>
          {analytics.attempt_stats.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.attempt_stats} barCategoryGap="30%">
                <XAxis dataKey="attempt" tick={{ fill: '#7f7266', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `Attempt ${v}`} />
                <YAxis tick={{ fill: '#7f7266', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ border: '1px solid #eadfce', borderRadius: '12px', fontSize: '13px' }} formatter={(v: number) => [`${v}%`, 'Rate']} />
                <Bar dataKey="rate" fill="#c86f43" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-[#8c7f73]">No attempt data</p>}
        </div>
      </div>
    </div>
  )
}


// ─── TAB: PRIORITY QUEUE ────────────────────────────────────────────────────

function PriorityQueueTab({ leads, loading, tierFilter, searchQuery, onTierChange, onSearchChange, onSelectLead }: {
  leads: CampaignLeadDetail[]
  loading: boolean
  tierFilter: string
  searchQuery: string
  onTierChange: (v: string) => void
  onSearchChange: (v: string) => void
  onSelectLead: (l: CampaignLeadDetail) => void
}) {
  return (
    <div className="space-y-4 crm-page-enter">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={tierFilter}
          onChange={e => onTierChange(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-[#e2d6c7] bg-white text-sm font-medium text-[#2a231d] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30"
        >
          <option value="">All Tiers</option>
          {['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map(t => (
            <option key={t} value={t}>{TIER_CONFIG[t]?.emoji} {t}</option>
          ))}
        </select>
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            placeholder="Search name or phone..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[#e2d6c7] bg-white text-sm text-[#2a231d] pl-9 focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30"
          />
          <svg className="absolute left-3 top-3 w-4 h-4 text-[#8c7f73]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8" strokeWidth="2" /><path d="m21 21-4.35-4.35" strokeWidth="2" /></svg>
        </div>
        <span className="text-sm text-[#7f7266]">{leads.length} leads</span>
      </div>

      {/* Table */}
      {loading ? <Skeleton /> : (
        <div className="bg-white border border-[#eadfce] rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fcf7f0] border-b border-[#eadfce]">
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Tier</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Score</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Name</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Phone</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">CRM</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Eval</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Attempt</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold">Quality</th>
                  <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold w-[220px]">Summary</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => {
                  const cfg = TIER_CONFIG[lead.priority_tier] || TIER_CONFIG.P7
                  const evalTag = String(lead.call_eval_tag ?? '').trim().toLowerCase()
                  return (
                    <tr
                      key={`${lead.lead_id}-${lead.attempt_number}`}
                      onClick={() => onSelectLead(lead)}
                      className={`border-b border-[#f3ece2] cursor-pointer hover:bg-[#faf3ea] transition-colors ${cfg.row}`}
                    >
                      <td className="px-4 py-3"><TierBadge tier={lead.priority_tier} /></td>
                      <td className="px-4 py-3 font-bold text-[#2a231d]">{lead.priority_score}</td>
                      <td className="px-4 py-3 font-medium text-[#2a231d]">{lead.name || '—'}</td>
                      <td className="px-4 py-3 text-[#5f5348] font-mono text-xs">{lead.phone || '—'}</td>
                      <td className="px-4 py-3"><ScoreBadgeSmall score={lead.lead_score} /></td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${evalTag === 'yes' ? 'text-emerald-600' : 'text-gray-400'}`}>
                          {lead.call_eval_tag || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-[#5f5348]">#{lead.attempt_number}</td>
                      <td className="px-4 py-3">
                        {lead.call_quality?.overall_quality ? (
                          <span className={`text-xs font-semibold ${
                            (lead.call_quality.overall_quality ?? 0) >= 7 ? 'text-emerald-600' :
                            (lead.call_quality.overall_quality ?? 0) >= 4 ? 'text-amber-600' : 'text-red-500'
                          }`}>{lead.call_quality.overall_quality}/10</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#7f7266] truncate max-w-[220px]">{lead.summary?.slice(0, 80) || '—'}</td>
                    </tr>
                  )
                })}
                {leads.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-12 text-[#8c7f73]">No leads found for this filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── TAB: INSIGHTS ──────────────────────────────────────────────────────────

function InsightsTab({ insights }: { insights: CampaignInsight[] }) {
  if (!insights.length) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        No AI insights available yet. Ensure campaign has connected calls and backend AI config is enabled
        (set <span className="font-semibold">GROQ_API_KEY</span> and keep <span className="font-semibold">CAMPAIGN_AI_ENABLED=true</span>).
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 crm-page-enter">
      {insights.map(insight => (
        <div key={insight.id} className={`rounded-2xl border p-5 transition-all hover:shadow-md ${SEVERITY_COLORS[insight.severity as keyof typeof SEVERITY_COLORS] || SEVERITY_COLORS.info}`}>
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-[#2a231d] text-sm leading-snug flex-1">{insight.title}</h4>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ml-2 flex-shrink-0 ${SEVERITY_BADGE[insight.severity as keyof typeof SEVERITY_BADGE] || SEVERITY_BADGE.info}`}>
              {insight.severity.toUpperCase()}
            </span>
          </div>
          <div className="text-2xl font-bold text-[#2a231d] mb-2">{insight.metric_value}</div>
          <p className="text-xs text-[#5f5348] leading-relaxed mb-3">{insight.description}</p>
          <div className="bg-white/60 rounded-xl p-3 border border-white/80">
            <p className="text-[10px] uppercase tracking-wider text-[#8c7f73] font-semibold mb-1">💡 Recommendation</p>
            <p className="text-xs text-[#3a332b] leading-relaxed">{insight.recommendation}</p>
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── TAB: AGENT ASSIGNMENT ──────────────────────────────────────────────────

function AgentAssignmentTab({
  assignments,
  availableAgents,
  selectedAgentIds,
  onSelectedAgentIdsChange,
  onAssign,
  onSelectLead,
}: {
  assignments: ReturnType<typeof useAgentAssignments>['data'] extends (infer U)[] ? U[] : never[]
  availableAgents: Agent[]
  selectedAgentIds: string[]
  onSelectedAgentIdsChange: (ids: string[]) => void
  onAssign: () => void
  onSelectLead: (l: CampaignLeadDetail) => void
}) {
  const callAgents = availableAgents.filter((a) => a.role === 'call_agent')
  const defaultMode = selectedAgentIds.length === 0

  const toggleAgent = (agentId: string) => {
    if (selectedAgentIds.includes(agentId)) {
      onSelectedAgentIdsChange(selectedAgentIds.filter((id) => id !== agentId))
      return
    }
    onSelectedAgentIdsChange([...selectedAgentIds, agentId])
  }

  const useDefaultCallAgents = () => {
    onSelectedAgentIdsChange(callAgents.map((a) => a.id))
  }

  const clearSelection = () => {
    onSelectedAgentIdsChange([])
  }

  return (
    <div className="space-y-6 crm-page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#2a231d]">Agent Assignment</h3>
          <p className="text-sm text-[#7f7266]">
            Assignment is priority-based: top half of leads (higher priority) and bottom half are split across agent halves.
            Only selected agents are used. If none are selected, default pool is role: call_agent.
          </p>
        </div>
        <button
          onClick={onAssign}
          className="px-6 py-2.5 rounded-full bg-[#2a231d] text-white text-sm font-semibold hover:bg-[#3e342a] transition-colors shadow-md"
        >
          ⚡ Execute Auto-Assignment
        </button>
      </div>

      <div className="bg-white border border-[#eadfce] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-[#2a231d]">Selected Agents</p>
          <div className="flex gap-2">
            <button onClick={useDefaultCallAgents} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#d8c4ad] text-[#6a4b32] hover:bg-[#fcf7f0]">Use default call_agent</button>
            <button onClick={clearSelection} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#e3d7c8] text-[#7f7266] hover:bg-[#faf5ef]">Clear</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {availableAgents.map((agent) => {
            const selected = selectedAgentIds.includes(agent.id)
            return (
              <button
                key={agent.id}
                onClick={() => toggleAgent(agent.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${selected ? 'border-[#2a231d] bg-[#2a231d] text-white' : 'border-[#e2d2bd] bg-white text-[#5f5348] hover:bg-[#fcf7f0]'}`}
              >
                {agent.name} ({agent.role})
              </button>
            )
          })}
        </div>

        <p className="text-[11px] text-[#8c7f73] mt-3">
          {defaultMode
            ? `No explicit selection active. Using default role call_agent (${callAgents.length} agent(s)).`
            : `Using ${selectedAgentIds.length} selected agent(s) for this assignment run.`}
        </p>
      </div>

      {assignments.length === 0 ? (
        <div className="bg-white border border-[#eadfce] rounded-3xl p-8 text-center">
          <p className="text-[#8c7f73]">No assignment candidates found. Select agents, or create active users with role call_agent.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {assignments.map((agent: any, idx: number) => (
            <div key={agent.agent_id} className="bg-white border border-[#eadfce] rounded-3xl overflow-hidden">
              <div className={`px-5 py-4 ${idx === 0 ? 'bg-gradient-to-r from-red-50 to-orange-50' : idx === 1 ? 'bg-gradient-to-r from-amber-50 to-yellow-50' : 'bg-gradient-to-r from-blue-50 to-gray-50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${idx === 0 ? 'bg-red-500' : idx === 1 ? 'bg-amber-500' : 'bg-blue-500'}`}>
                    {(agent.agent_name || '?').charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#2a231d]">{agent.agent_name}</h4>
                    <p className="text-xs text-[#7f7266]">{agent.lead_count} leads assigned</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {Object.entries(agent.tier_breakdown || {}).map(([tier, count]) => (
                    <span key={tier} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${(TIER_CONFIG[tier] || TIER_CONFIG.P7).bg} ${(TIER_CONFIG[tier] || TIER_CONFIG.P7).text} ${(TIER_CONFIG[tier] || TIER_CONFIG.P7).border}`}>
                      {tier}: {count as number}
                    </span>
                  ))}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {(agent.leads || []).slice(0, 10).map((lead: CampaignLeadDetail) => (
                  <div
                    key={`${lead.lead_id}-${lead.attempt_number}`}
                    onClick={() => onSelectLead(lead)}
                    className="flex items-center gap-3 px-5 py-2.5 border-b border-[#f3ece2] cursor-pointer hover:bg-[#faf3ea] transition-colors"
                  >
                    <TierBadge tier={lead.priority_tier} />
                    <span className="text-sm font-medium text-[#2a231d] flex-1 truncate">{lead.name || '—'}</span>
                    <span className="text-xs text-[#8c7f73] font-mono">{lead.phone?.slice(-4)}</span>
                  </div>
                ))}
                {(agent.leads || []).length > 10 && (
                  <p className="px-5 py-2 text-xs text-[#8c7f73]">+{(agent.leads as any[]).length - 10} more leads</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ─── TAB: AI ANALYSIS ───────────────────────────────────────────────────────

function AiAnalysisTab({ leads, loading, running, lastRunMessage, onRunAi, onSelectLead }: {
  leads: CampaignLeadDetail[]
  loading: boolean
  running: boolean
  lastRunMessage?: string | null
  onRunAi: () => void
  onSelectLead: (l: CampaignLeadDetail) => void
}) {
  const analyzedLeads = leads.filter((l) => l.ai_analysis && Object.keys(l.ai_analysis).length > 0)
  const pendingLeads = leads.filter((l) => {
    const hasAnalysis = Boolean(l.ai_analysis && Object.keys(l.ai_analysis).length > 0)
    const transcript = String(l.transcript || '').trim()
    const summary = String(l.summary || '').trim()
    const evalTag = String(l.call_eval_tag || '').trim().toLowerCase()

    const hasTranscriptContext = transcript.length > 20 && transcript.toLowerCase() !== 'transcript not found'
    const hasSummaryContext = summary.length > 20
    const isConnected = evalTag === 'yes' || hasTranscriptContext || hasSummaryContext

    return !hasAnalysis && isConnected && (hasTranscriptContext || hasSummaryContext)
  })

  return (
    <div className="space-y-6 crm-page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#2a231d]">AI-Powered Analysis</h3>
          <p className="text-sm text-[#7f7266]">
            {analyzedLeads.length} analyzed · {pendingLeads.length} pending · Uses Groq LLaMA 3.3 70B
          </p>
        </div>
        <button
          onClick={onRunAi}
          disabled={running || pendingLeads.length === 0}
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c86f43] to-[#e8a06c] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-md disabled:opacity-50"
        >
          {running ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" /><path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
              Analyzing {pendingLeads.length} calls...
            </span>
          ) : `🤖 Run AI Analysis (${pendingLeads.length} calls)`}
        </button>
      </div>

      {lastRunMessage ? (
        <div className="rounded-xl border border-[#eadfce] bg-white px-4 py-3 text-xs text-[#5f5348]">
          {lastRunMessage}
        </div>
      ) : null}

      {loading ? <Skeleton /> : analyzedLeads.length === 0 ? (
        <div className="bg-white border border-[#eadfce] rounded-3xl p-12 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <h4 className="text-lg font-semibold text-[#2a231d] mb-2">No AI Analysis Yet</h4>
          <p className="text-sm text-[#7f7266] max-w-md mx-auto">
            Click &quot;Run AI Analysis&quot; to analyze all {pendingLeads.length} connected calls using Groq&apos;s LLaMA 3.3 70B model.
            Each call&apos;s transcript will be analyzed for engagement, intent, objections, and action recommendations.
          </p>
          <p className="text-xs text-[#8c7f73] mt-3">Estimated cost: ~$0.01–$0.05 for this campaign</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {analyzedLeads.map(lead => {
            const ai = lead.ai_analysis || {}
            return (
              <div
                key={`${lead.lead_id}-ai`}
                onClick={() => onSelectLead(lead)}
                className="bg-white border border-[#eadfce] rounded-2xl p-5 cursor-pointer hover:shadow-md transition-all hover:border-[#c86f43]/30"
              >
                <div className="flex items-center gap-3 mb-3">
                  <TierBadge tier={lead.priority_tier} />
                  <span className="font-semibold text-[#2a231d] flex-1 truncate">{lead.name}</span>
                  {ai.engagement_level && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      ai.engagement_level === 'high' ? 'bg-emerald-100 text-emerald-700' :
                      ai.engagement_level === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>{String(ai.engagement_level).toUpperCase()}</span>
                  )}
                </div>
                {ai.lead_quality_assessment && (
                  <p className="text-xs text-[#5f5348] mb-2 line-clamp-2">{String(ai.lead_quality_assessment)}</p>
                )}
                {ai.suggested_next_action && (
                  <div className="bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-900">
                    <span className="font-semibold">Action:</span> {String(ai.suggested_next_action)}
                  </div>
                )}
                {ai.close_probability !== undefined && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] text-[#8c7f73]">Close probability:</span>
                    <div className="flex-1 h-1.5 bg-[#f0e8dd] rounded-full">
                      <div className="h-full rounded-full bg-[#c86f43]" style={{ width: `${Number(ai.close_probability)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-[#2a231d]">{String(ai.close_probability)}%</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
