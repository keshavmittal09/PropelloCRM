'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import { campaignsApi } from '@/lib/api'
import { useCampaign, useProjects } from '@/hooks/useQueries'
import { ScoreBadge } from '@/components/shared/Badges'
import toast from 'react-hot-toast'

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const campaignId = params?.id ?? ''

  const { data: campaign, isLoading, refetch } = useCampaign(campaignId)
  const { data: projects } = useProjects()
  const [assigning, setAssigning] = useState(false)
  const [selectedProject, setSelectedProject] = useState('')

  const sortedLeads = useMemo(() => {
    if (!campaign?.leads) return []
    const rank: Record<string, number> = { hot: 0, warm: 1, cold: 2 }
    return [...campaign.leads].sort((a, b) => (rank[a.lead_score] ?? 99) - (rank[b.lead_score] ?? 99))
  }, [campaign])

  const assignProject = async () => {
    if (!selectedProject || !campaignId) return
    setAssigning(true)
    try {
      await campaignsApi.assignProject(campaignId, selectedProject)
      toast.success('Project linked to campaign')
      await refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to assign project')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        {isLoading || !campaign ? (
          <p className="text-[#7f7266]">Loading campaign...</p>
        ) : (
          <>
            <h1 className="text-3xl font-semibold text-[#2a231d] tracking-tight">{campaign.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <p className="text-sm text-[#7f7266]">Agent: {campaign.agent_name || 'Niharika'} · {new Date(campaign.created_at).toLocaleString()}</p>
              <button
                onClick={() => router.push(`/campaigns/${campaignId}/dashboard`)}
                className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#c86f43] to-[#e8a06c] text-white text-xs font-semibold shadow-sm hover:opacity-90 transition-opacity"
              >
                📊 Open Analytics Dashboard
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-6">
              <Stat label="Total" value={campaign.total_calls} />
              <Stat label="Hot" value={campaign.hot_count} tone="text-red-600" />
              <Stat label="Warm" value={campaign.warm_count} tone="text-amber-600" />
              <Stat label="Cold" value={campaign.cold_count} tone="text-slate-600" />
              <Stat label="New" value={campaign.new_leads_created} />
              <Stat label="Updated" value={campaign.existing_leads_updated} />
            </div>

            <div className="mt-5 bg-white border border-[#eadfce] rounded-2xl p-4">
              <p className="text-sm text-[#5f5348]">
                Linked project: <span className="font-semibold text-[#2a231d]">{campaign.project_name || 'Not linked'}</span>
              </p>
              {!campaign.project_id && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-[#e2d2bd] text-sm bg-white"
                  >
                    <option value="">Assign to project</option>
                    {projects?.map((p) => (
                      <option value={p.id} key={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={assignProject}
                    disabled={!selectedProject || assigning}
                    className="px-4 py-2 rounded-full bg-[#2a231d] text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {assigning ? 'Assigning...' : 'Assign'}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 bg-white border border-[#eadfce] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#fcf7f0]">
                  <tr>
                    <th className="text-left px-3 py-2">Score</th>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Phone</th>
                    <th className="text-left px-3 py-2">Stage</th>
                    <th className="text-left px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeads.map((lead) => (
                    <tr key={lead.id} className="border-t border-[#f3ece2]">
                      <td className="px-3 py-2"><ScoreBadge score={lead.lead_score} /></td>
                      <td className="px-3 py-2">{lead.contact?.name || '—'}</td>
                      <td className="px-3 py-2">{lead.contact?.phone || '—'}</td>
                      <td className="px-3 py-2">{lead.stage}</td>
                      <td className="px-3 py-2">
                        <button className="text-[#a65630] hover:underline" onClick={() => router.push(`/leads/${lead.id}`)}>
                          Open lead
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, tone = 'text-[#2a231d]' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-white border border-[#eadfce] rounded-2xl p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-[#8c7f73] font-semibold">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</p>
    </div>
  )
}
