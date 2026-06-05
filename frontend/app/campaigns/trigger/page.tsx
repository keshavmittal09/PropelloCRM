'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import { campaignsApi } from '@/lib/api'
import type { Campaign } from '@/lib/types'
import { useAuthStore } from '@/store/useAuthStore'
import { canAccessFeature } from '@/hooks/useRoleGuard'
import toast from 'react-hot-toast'

interface WaTemplate { id: string; name: string; body: string; language: string }
interface TriggerResult { total: number; sent: number; failed: number; skipped: number; results: { lead_id: string; phone?: string; status: string; reason?: string }[] }

export default function TriggerCampaignPage() {
  const router = useRouter()
  const { agent } = useAuthStore()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [templatesError, setTemplatesError] = useState(false)

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null)
  const [customMessage, setCustomMessage] = useState('')
  const [campaignTag, setCampaignTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TriggerResult | null>(null)

  useEffect(() => {
    if (agent && !canAccessFeature(agent.role as any, 'campaign_management')) {
      router.push('/unauthorized')
    }
  }, [agent, router])

  useEffect(() => {
    campaignsApi.getCampaigns().then(setCampaigns).catch(() => toast.error('Failed to load campaigns'))
    campaignsApi.getWhatsAppTemplates()
      .then(setTemplates)
      .catch(() => setTemplatesError(true))
  }, [])

  const message = selectedTemplate ? selectedTemplate.body : customMessage

  const canSend = !!selectedCampaign && !!message.trim() && !loading

  const handleSend = async () => {
    if (!selectedCampaign || !message.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await campaignsApi.triggerCampaignWhatsApp(selectedCampaign.id, {
        message: message.trim(),
        template_name: selectedTemplate?.name ?? '',
        campaign_tag: campaignTag.trim() || selectedCampaign.name,
      })
      setResult(res)
      toast.success(`Campaign sent! ${res.sent}/${res.total} delivered`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to trigger campaign')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 max-w-3xl">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => router.push('/campaigns')} className="text-[#9d9185] hover:text-[#2a231d] text-sm">← Back</button>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-[#2a231d] tracking-tight mb-1">Trigger Campaign</h1>
        <p className="text-sm text-[#7f7266] mb-8">Send WhatsApp messages to all leads in a campaign using your Meta-approved templates.</p>

        <div className="space-y-6">
          {/* Step 1: Pick Campaign */}
          <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-3">Step 1 — Select Campaign</p>
            {campaigns.length === 0 ? (
              <p className="text-sm text-[#9d9185]">No campaigns found. Upload one first.</p>
            ) : (
              <div className="grid gap-2">
                {campaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCampaign(c); setCampaignTag(c.name) }}
                    className={`w-full text-left px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                      selectedCampaign?.id === c.id
                        ? 'border-[#2a231d] bg-[#2a231d] text-white'
                        : 'border-[#e4d7c5] bg-white text-[#2a231d] hover:border-[#c8b49a] hover:bg-[#fffaf5]'
                    }`}
                  >
                    <span className="font-semibold">{c.name}</span>
                    <span className={`ml-2 text-xs ${selectedCampaign?.id === c.id ? 'text-[#d6b294]' : 'text-[#9d9185]'}`}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Step 2: Pick Template */}
          <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-3">Step 2 — WhatsApp Template</p>
            {templatesError ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                  WATI not configured — enter a custom message below instead.
                </p>
                <textarea
                  value={customMessage}
                  onChange={e => { setCustomMessage(e.target.value); setSelectedTemplate(null) }}
                  rows={4}
                  placeholder="Hi {name}, following up on your interest..."
                  className="w-full px-4 py-3 border border-[#e4d7c5] rounded-2xl text-sm bg-white focus:outline-none focus:border-[#c8b49a] resize-none"
                />
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-[#9d9185]">Loading templates...</p>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t); setCustomMessage('') }}
                    className={`w-full text-left px-4 py-3 rounded-2xl border transition-all ${
                      selectedTemplate?.id === t.id
                        ? 'border-green-500 bg-green-50'
                        : 'border-[#e4d7c5] bg-white hover:border-[#c8b49a] hover:bg-[#fffaf5]'
                    }`}
                  >
                    <p className="text-sm font-semibold text-[#2a231d]">{t.name}</p>
                    <p className="text-xs text-[#7f7266] mt-0.5 line-clamp-2">{t.body}</p>
                    <span className="text-[10px] text-[#9d9185]">{t.language}</span>
                  </button>
                ))}
                <div className="pt-2">
                  <p className="text-xs text-[#9d9185] mb-1 font-medium">Or write a custom message</p>
                  <textarea
                    value={customMessage}
                    onChange={e => { setCustomMessage(e.target.value); setSelectedTemplate(null) }}
                    rows={3}
                    placeholder="Hi {name}, following up..."
                    className="w-full px-4 py-3 border border-[#e4d7c5] rounded-2xl text-sm bg-white focus:outline-none focus:border-[#c8b49a] resize-none"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Step 3: Campaign Tag */}
          <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-3">Step 3 — Campaign Tag (optional)</p>
            <input
              value={campaignTag}
              onChange={e => setCampaignTag(e.target.value)}
              placeholder={selectedCampaign?.name ?? 'Day 1, Follow-up…'}
              className="w-full px-4 py-2.5 border border-[#e4d7c5] rounded-2xl text-sm bg-white focus:outline-none focus:border-[#c8b49a]"
            />
            <p className="text-xs text-[#9d9185] mt-1">Labels this batch in the WhatsApp agent. Defaults to the campaign name.</p>
          </section>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full py-3.5 rounded-full bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-all disabled:opacity-40 shadow-sm"
          >
            {loading ? 'Sending…' : selectedCampaign ? `🚀 Send to all leads in "${selectedCampaign.name}"` : '🚀 Start Campaign'}
          </button>

          {/* Results */}
          {result && (
            <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-4">Results</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-green-50 border border-green-100 rounded-2xl">
                  <p className="text-2xl font-bold text-green-700">{result.sent}</p>
                  <p className="text-xs text-green-600 font-medium mt-0.5">Sent</p>
                </div>
                <div className="text-center p-3 bg-red-50 border border-red-100 rounded-2xl">
                  <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                  <p className="text-xs text-red-500 font-medium mt-0.5">Failed</p>
                </div>
                <div className="text-center p-3 bg-gray-50 border border-gray-100 rounded-2xl">
                  <p className="text-2xl font-bold text-gray-500">{result.skipped}</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Skipped</p>
                </div>
              </div>
              {result.failed > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-500 mb-1">Failed deliveries</p>
                  {result.results.filter(r => r.status === 'failed').map(r => (
                    <div key={r.lead_id} className="text-xs text-[#7f7266] px-3 py-1.5 bg-red-50 rounded-lg">
                      {r.phone ?? r.lead_id} — {r.reason}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
