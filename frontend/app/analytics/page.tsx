'use client'
import { useAnalyticsSummary, useFunnel, useSourceStats, useAgentStats } from '@/hooks/useQueries'
import Sidebar from '@/components/shared/Sidebar'
import { formatCurrency, stageConfig, sourceLabels } from '@/lib/utils'
import type { LeadSource, LeadStage } from '@/lib/types'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'

const PIE_COLORS = ['#6366f1', '#8b5cf6', '#f59e0b', '#f97316', '#06b6d4', '#10b981', '#ef4444', '#94a3b8', '#ec4899', '#64748b']

function SummaryCard({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 border ${accent ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200'}`}>
      <p className={`text-sm font-medium ${accent ? 'text-indigo-200' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${accent ? 'text-indigo-300' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 className="font-semibold text-gray-900 mb-5">{title}</h3>
      {children}
    </div>
  )
}

export default function AnalyticsPage() {
  const { data: summary } = useAnalyticsSummary()
  const { data: funnel } = useFunnel()
  const { data: sources } = useSourceStats()
  const { data: agents } = useAgentStats()

  const funnelData = funnel?.map(f => ({
    name: stageConfig[f.stage as LeadStage]?.label ?? f.stage,
    count: f.count,
    pct: f.percentage,
  }))

  const sourceData = sources?.map(s => ({
    name: sourceLabels[s.source as LeadSource] ?? s.source,
    count: s.count,
    won: s.won,
    rate: s.conversion_rate,
  }))

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <p className="text-gray-500 mt-1">Last 30 days performance overview</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <SummaryCard label="Total leads" value={summary?.total_leads ?? '—'} />
          <SummaryCard label="New today" value={summary?.new_leads_today ?? '—'} />
          <SummaryCard label="Hot leads" value={summary?.hot_leads ?? '—'} />
          <SummaryCard label="Won this month" value={summary?.won_this_month ?? '—'} accent />
          <SummaryCard label="Lost this month" value={summary?.lost_this_month ?? '—'} />
          <SummaryCard label="Pipeline value" value={formatCurrency(summary?.pipeline_value ?? 0)} sub="active leads" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          {/* Funnel chart */}
          <Section title="Sales pipeline funnel">
            {funnelData?.length ? (
              <div className="space-y-3">
                {funnelData.filter(f => !['won', 'lost', 'nurture'].includes(f.name.toLowerCase())).map((f, i) => (
                  <div key={f.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{f.name}</span>
                      <span className="text-gray-500">{f.count} leads · {f.pct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(f.pct, 2)}%`, backgroundColor: Object.values(stageConfig)[i]?.color ?? '#6366f1' }} />
                    </div>
                  </div>
                ))}
                <div className="flex gap-6 mt-4 pt-4 border-t border-gray-100">
                  {funnelData.filter(f => ['Won', 'Lost'].includes(f.name)).map(f => (
                    <div key={f.name}>
                      <p className="text-xs text-gray-500">{f.name}</p>
                      <p className="text-xl font-bold mt-0.5" style={{ color: f.name === 'Won' ? '#10b981' : '#ef4444' }}>{f.count}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : <Skeleton />}
          </Section>

          {/* Source pie chart */}
          <Section title="Leads by source">
            {sourceData?.length ? (
              <div className="flex items-center justify-center">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={sourceData} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3}>
                      {sourceData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v} leads`, 'Count']} />
                    <Legend iconType="circle" iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : <Skeleton />}
          </Section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Source conversion */}
          <Section title="Source conversion rates">
            {sourceData?.length ? (
              <div className="space-y-3">
                {sourceData.sort((a, b) => b.rate - a.rate).map((s, i) => (
                  <div key={s.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700 truncate">{s.name}</span>
                        <span className="text-gray-500 flex-shrink-0">{s.count} leads · <span className="text-emerald-600 font-medium">{s.rate}%</span></span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(s.rate, 2)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <Skeleton />}
          </Section>

          {/* Agent leaderboard */}
          <Section title="Agent performance">
            {agents?.length ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 text-xs font-semibold text-gray-500 mb-3 px-2">
                  <span>Agent</span>
                  <span className="text-right">Leads</span>
                  <span className="text-right">Won</span>
                  <span className="text-right">Conversion</span>
                </div>
                {agents.map((a, i) => (
                  <div key={a.agent_id} className={`grid grid-cols-4 items-center px-3 py-3 rounded-xl ${i === 0 ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-500'}`}>
                        {i + 1}
                      </div>
                      <span className="text-sm font-medium text-gray-800 truncate">{a.agent_name.split(' ')[0]}</span>
                    </div>
                    <span className="text-sm text-gray-600 text-right">{a.total_leads}</span>
                    <span className="text-sm font-semibold text-emerald-600 text-right">{a.won}</span>
                    <span className="text-sm font-semibold text-indigo-600 text-right">{a.conversion_rate}%</span>
                  </div>
                ))}
              </div>
            ) : <Skeleton />}
          </Section>
        </div>
      </main>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded-lg" />)}
    </div>
  )
}
