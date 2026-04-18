'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import { campaignsApi } from '@/lib/api'
import type { CampaignPreview, CampaignResult } from '@/lib/types'
import toast from 'react-hot-toast'

export default function CampaignsPage() {
  const router = useRouter()
  const [campaignName, setCampaignName] = useState('')
  const [agentName, setAgentName] = useState('Niharika')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)

  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [result, setResult] = useState<CampaignResult | null>(null)

  const canUpload = !!campaignName.trim() && !!file

  const sortedLeads = useMemo(() => {
    if (!result?.leads) return []
    return [...result.leads].sort((a, b) => {
      const rank: Record<string, number> = { hot: 0, warm: 1, cold: 2 }
      return (rank[a.score] ?? 99) - (rank[b.score] ?? 99)
    })
  }, [result])

  const onChooseFile = async (f: File | null) => {
    setFile(f)
  }

  const onPreview = async () => {
    if (!file || !campaignName.trim()) return
    setLoading(true)
    try {
      const data = await campaignsApi.uploadCampaignPreview(file, campaignName.trim(), agentName.trim() || 'Niharika')
      setPreview(data)
      setResult(null)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }

  const onImport = async () => {
    if (!preview) return
    setLoading(true)
    try {
      const data = await campaignsApi.ingestCampaign({
        campaign_name: campaignName.trim(),
        agent_name: agentName.trim() || 'Niharika',
        rows: preview.rows,
      })
      setResult(data)
      setPreview(null)
      toast.success('Campaign import complete')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setCampaignName('')
    setAgentName('Niharika')
    setFile(null)
    setPreview(null)
    setResult(null)
  }

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <h1 className="text-3xl font-semibold text-[#2a231d] tracking-tight mb-2">Campaign Ingestion</h1>
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <p className="text-sm text-[#7f7266]">Upload Niharika campaign output and auto-classify leads.</p>
          <button
            onClick={() => router.push('/campaigns/dashboard')}
            className="px-4 py-1.5 rounded-full border border-[#d8c4ad] bg-white text-xs font-semibold text-[#5f5348] hover:bg-[#fcf7f0] transition-colors"
          >
            Open Campaign Dashboard Hub
          </button>
        </div>

        {!preview && !result && (
          <section className="max-w-3xl bg-white border border-[#eadfce] rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <label className="text-sm font-medium text-[#2a231d]">Campaign name</label>
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#e4d7c5] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#d6b294]/40"
                placeholder="Krishna Aura — Credai Expo April 2026"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-[#2a231d]">Agent name (optional)</label>
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#e4d7c5] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#d6b294]/40"
                placeholder="Niharika"
              />
            </div>

            <label className="block border-2 border-dashed border-[#d8c4ad] rounded-2xl p-6 text-center bg-[#fffaf5] hover:bg-[#fff7ef] transition-colors cursor-pointer">
              <input
                type="file"
                accept=",csv,.json,.xlsx,.xls"
                className="hidden"
                onChange={(e) => onChooseFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-sm text-[#5f5348] font-medium">Drag & drop or choose CSV / JSON / Excel file</p>
              <p className="text-xs text-[#8a7d70] mt-1">Accepted formats: .csv, .json, .xlsx, .xls</p>
              {file && <p className="text-xs text-[#2a231d] mt-3 font-semibold">Selected: {file.name}</p>}
            </label>

            <div className="pt-2">
              <button
                onClick={onPreview}
                disabled={!canUpload || loading}
                className="px-5 py-2.5 rounded-full bg-[#2a231d] text-white text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Parsing...' : 'Preview File'}
              </button>
            </div>
          </section>
        )}

        {preview && !result && (
          <section className="bg-white border border-[#eadfce] rounded-3xl p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <p className="text-sm text-[#6f6255]">{preview.total} rows detected from {file?.name}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreview(null)}
                  className="px-4 py-2 rounded-full border border-[#e2d2bd] text-sm text-[#5f5348]"
                >
                  Back
                </button>
                <button
                  onClick={onImport}
                  disabled={loading}
                  className="px-4 py-2 rounded-full bg-[#2a231d] text-white text-sm font-semibold disabled:opacity-50"
                >
                  {loading ? 'Classifying leads...' : `Import and Classify ${preview.total} Leads`}
                </button>
              </div>
            </div>

            <div className="overflow-auto border border-[#f0e5d7] rounded-xl max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-[#fcf7f0] sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Phone</th>
                    <th className="text-left px-3 py-2">Summary</th>
                    <th className="text-left px-3 py-2">Eval</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, idx) => (
                    <tr key={`${row.call_id}-${idx}`} className="border-t border-[#f3ece2]">
                      <td className="px-3 py-2">{row.name || '—'}</td>
                      <td className="px-3 py-2">{row.phone_number || '—'}</td>
                      <td className="px-3 py-2 max-w-[540px] truncate" title={row.summary}>{row.summary || '—'}</td>
                      <td className="px-3 py-2">{row.call_eval_tag || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {result && (
          <section className="space-y-5">
            <div className="bg-white border border-[#eadfce] rounded-3xl p-6 shadow-sm">
              <p className="text-sm text-[#5f5348]">
                {result.total} leads processed —
                <span className="text-red-600 font-semibold"> {result.hot} Hot</span> ·
                <span className="text-amber-600 font-semibold"> {result.warm} Warm</span> ·
                <span className="text-slate-600 font-semibold"> {result.cold} Cold</span> —
                <span className="font-semibold text-[#2a231d]"> {result.created} new</span> ·
                <span className="font-semibold text-[#2a231d]"> {result.updated} updated</span>
              </p>
              {(result.skipped_duplicates > 0 || result.failed_rows > 0) && (
                <p className="text-xs text-[#8a7d70] mt-2">
                  Skipped duplicates: {result.skipped_duplicates} · Failed rows: {result.failed_rows}
                </p>
              )}
              {result.tier_distribution && Object.keys(result.tier_distribution).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#f0e5d7]">
                  <span className="text-xs text-[#8c7f73] font-medium self-center mr-1">Priority Tiers:</span>
                  {Object.entries(result.tier_distribution).sort(([a], [b]) => a.localeCompare(b)).map(([tier, count]) => (
                    <span key={tier} className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                      tier === 'P1' ? 'bg-red-50 text-red-700 border-red-200' :
                      tier === 'P2' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                      tier === 'P3' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      tier === 'P4' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      'bg-gray-50 text-gray-500 border-gray-200'
                    }`}>{tier}: {count as number}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-[#eadfce] rounded-3xl p-6 shadow-sm">
              <div className="overflow-auto border border-[#f0e5d7] rounded-xl max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="bg-[#fcf7f0] sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Score</th>
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2">Phone</th>
                      <th className="text-left px-3 py-2">Summary</th>
                      <th className="text-left px-3 py-2">Stage</th>
                      <th className="text-left px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeads.map((lead) => (
                      <tr key={lead.lead_id} className="border-t border-[#f3ece2]">
                        <td className="px-3 py-2 capitalize font-semibold">{lead.score}</td>
                        <td className="px-3 py-2">{lead.name}</td>
                        <td className="px-3 py-2">{lead.phone}</td>
                        <td className="px-3 py-2 max-w-[400px] truncate" title={lead.summary ?? ''}>{lead.summary || '—'}</td>
                        <td className="px-3 py-2">{lead.stage}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => router.push(`/leads/${lead.lead_id}`)} className="text-[#a65630] hover:underline">
                            Open lead
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={() => router.push(`/campaigns/${result.campaign_id}/dashboard`)}
                  className="px-5 py-2.5 rounded-full bg-gradient-to-r from-[#c86f43] to-[#e8a06c] text-white text-sm font-semibold shadow-md hover:opacity-90 transition-opacity"
                >
                  📊 Open Campaign Dashboard
                </button>
                <button
                  onClick={() => router.push(`/leads?source=campaign&campaign_id=${result.campaign_id}`)}
                  className="px-4 py-2 rounded-full bg-[#2a231d] text-white text-sm font-semibold"
                >
                  View All Leads
                </button>
                <button
                  onClick={reset}
                  className="px-4 py-2 rounded-full border border-[#e2d2bd] text-sm text-[#5f5348]"
                >
                  Import Another Campaign
                </button>
                <button
                  onClick={() => router.push(`/campaigns/${result.campaign_id}`)}
                  className="px-4 py-2 rounded-full border border-[#e2d2bd] text-sm text-[#5f5348]"
                >
                  Open Campaign Detail
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
