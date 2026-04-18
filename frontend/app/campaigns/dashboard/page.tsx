'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import { useCampaignAnalytics, useCampaigns } from '@/hooks/useQueries'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-[#eadfce] rounded-2xl p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[#8c7f73] font-semibold">{label}</p>
      <p className="text-2xl font-semibold text-[#2a231d] mt-1">{value}</p>
      {sub ? <p className="text-xs text-[#8c7f73] mt-1">{sub}</p> : null}
    </div>
  )
}

export default function CampaignDashboardHubPage() {
  const router = useRouter()
  const { data: campaigns = [], isLoading } = useCampaigns(0, 100)
  const [selectedCampaignId, setSelectedCampaignId] = useState('')

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0].id)
    }
  }, [campaigns, selectedCampaignId])

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) || campaigns[0],
    [campaigns, selectedCampaignId],
  )

  const activeCampaignId = selectedCampaign?.id || ''
  const { data: analytics, isLoading: analyticsLoading } = useCampaignAnalytics(activeCampaignId)

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-[#2a231d] tracking-tight">Campaign Dashboard Hub</h1>
            <p className="text-sm text-[#7f7266] mt-1">
              Always-available dashboard access for all imported campaigns.
            </p>
          </div>
          <button
            onClick={() => router.push('/campaigns')}
            className="px-4 py-2 rounded-full bg-[#2a231d] text-white text-sm font-semibold hover:bg-[#3e342a] transition-colors"
          >
            Import New Campaign
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-24 rounded-2xl bg-[#efe6db]" />
            <div className="h-24 rounded-2xl bg-[#efe6db]" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white border border-[#eadfce] rounded-3xl p-10 text-center">
            <h2 className="text-xl font-semibold text-[#2a231d]">No Campaigns Yet</h2>
            <p className="text-sm text-[#7f7266] mt-2 mb-5">
              Import your first campaign file to start seeing analytics and priority queues.
            </p>
            <button
              onClick={() => router.push('/campaigns')}
              className="px-5 py-2.5 rounded-full bg-[#2a231d] text-white text-sm font-semibold hover:bg-[#3e342a] transition-colors"
            >
              Go To Campaign Import
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6">
            <section className="bg-white border border-[#eadfce] rounded-3xl p-4 max-h-[78vh] overflow-auto">
              <h3 className="text-sm font-semibold text-[#2a231d] mb-3">Campaigns</h3>
              <div className="space-y-2">
                {campaigns.map((c) => {
                  const isActive = c.id === activeCampaignId
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCampaignId(c.id)}
                      className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                        isActive
                          ? 'bg-[#fdf5eb] border-[#d9bca4]'
                          : 'bg-white border-[#eadfce] hover:bg-[#fcf7f0]'
                      }`}
                    >
                      <p className="font-semibold text-[#2a231d] truncate">{c.name}</p>
                      <p className="text-xs text-[#8c7f73] mt-1">
                        {new Date(c.created_at).toLocaleString()} · Total: {c.total_calls}
                      </p>
                      <div className="flex gap-2 mt-2 text-[10px] font-semibold">
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">Hot {c.hot_count}</span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Warm {c.warm_count}</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Cold {c.cold_count}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="space-y-4">
              <div className="bg-white border border-[#eadfce] rounded-3xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-[#2a231d] tracking-tight">
                      {selectedCampaign?.name || 'Campaign'}
                    </h2>
                    <p className="text-sm text-[#7f7266]">Live overview for selected campaign</p>
                  </div>
                  {activeCampaignId ? (
                    <button
                      onClick={() => router.push(`/campaigns/${activeCampaignId}/dashboard`)}
                      className="px-4 py-2 rounded-full bg-gradient-to-r from-[#c86f43] to-[#e8a06c] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      Open Full Interactive Dashboard
                    </button>
                  ) : null}
                </div>

                {analyticsLoading || !analytics ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-20 rounded-2xl bg-[#efe6db]" />
                    <div className="h-20 rounded-2xl bg-[#efe6db]" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <StatCard label="Total Dialed" value={analytics.total_dialed} />
                      <StatCard label="Connected" value={analytics.total_connected} sub={`${analytics.connection_rate}% rate`} />
                      <StatCard label="Eval Yes" value={analytics.eval_yes} />
                      <StatCard label="Avg Quality" value={`${analytics.avg_overall_quality}/10`} />
                    </div>

                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <StatCard label="Hot" value={analytics.hot_count} />
                      <StatCard label="Warm" value={analytics.warm_count} />
                      <StatCard label="Cold" value={analytics.cold_count} />
                    </div>

                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-[#2a231d] mb-2">Top Insights</h3>
                      <div className="space-y-2">
                        {(analytics.insights || []).slice(0, 4).map((insight) => (
                          <div key={insight.id} className="border border-[#eadfce] rounded-xl px-3 py-2 bg-[#fffaf5]">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-[#2a231d]">{insight.title}</p>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  insight.severity === 'critical'
                                    ? 'bg-red-100 text-red-700'
                                    : insight.severity === 'warning'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {insight.severity.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-[#7f7266] mt-1">{insight.description}</p>
                          </div>
                        ))}
                        {(!analytics.insights || analytics.insights.length === 0) ? (
                          <p className="text-sm text-[#8c7f73]">No computed insights yet.</p>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
