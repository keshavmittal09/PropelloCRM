'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import { campaignsApi } from '@/lib/api'
import type { Campaign } from '@/lib/types'
import { useAuthStore } from '@/store/useAuthStore'
import { canAccessFeature } from '@/hooks/useRoleGuard'
import toast from 'react-hot-toast'

interface WaTemplate { id: string; name: string; body: string; status: string; language: string }
interface SendResult { total: number; sent: number; failed: number; skipped?: number; results: { phone?: string; lead_id?: string; status: string; reason?: string }[] }

type Mode = 'campaign' | 'phones'

const LANGUAGES = ['English', 'Hindi', 'en', 'hi', 'en_US', 'en_GB']

export default function TriggerCampaignPage() {
  const router = useRouter()
  const { agent } = useAuthStore()
  const [mode, setMode] = useState<Mode>('campaign')

  // shared
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesError, setTemplatesError] = useState(false)
  const [templatesErrorMsg, setTemplatesErrorMsg] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null)
  const [customMessage, setCustomMessage] = useState('')
  const [language, setLanguage] = useState('English')
  const [variableName, setVariableName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  // campaign mode
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [campaignTag, setCampaignTag] = useState('')

  // phones mode
  const [phonesInput, setPhonesInput] = useState('')
  const [broadcastTag, setBroadcastTag] = useState('Broadcast')

  useEffect(() => {
    if (agent && !canAccessFeature(agent.role as any, 'campaign_management')) {
      router.push('/unauthorized')
    }
  }, [agent, router])

  useEffect(() => {
    campaignsApi.getCampaigns().then(setCampaigns).catch(() => toast.error('Failed to load campaigns'))
    campaignsApi.getWhatsAppTemplates()
      .then(data => { setTemplates(data); setTemplatesLoading(false) })
      .catch((e: any) => {
        setTemplatesError(true)
        setTemplatesLoading(false)
        setTemplatesErrorMsg(e?.response?.data?.detail || e?.message || 'Could not load templates')
      })
  }, [])

  const message = selectedTemplate ? selectedTemplate.body : customMessage

  const parsedPhones = phonesInput
    .split(/[\n,]/)
    .map(p => p.trim())
    .filter(Boolean)

  const canSendCampaign = !!selectedCampaign && !!message.trim() && !loading
  const canSendPhones = parsedPhones.length > 0 && !!message.trim() && !loading

  const handleSendCampaign = async () => {
    if (!selectedCampaign || !message.trim()) return
    setLoading(true); setResult(null)
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
    } finally { setLoading(false) }
  }

  const handleSendPhones = async () => {
    if (!parsedPhones.length || !message.trim()) return
    setLoading(true); setResult(null)
    try {
      const res = await campaignsApi.broadcastPhones({
        phones: parsedPhones,
        message: message.trim(),
        template_name: selectedTemplate?.name ?? '',
        language,
        variable_name: variableName,
        campaign_tag: broadcastTag,
      })
      setResult(res)
      toast.success(`Sent! ${res.sent}/${res.total} delivered`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to send')
    } finally { setLoading(false) }
  }

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 max-w-3xl">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => router.push('/campaigns')} className="text-[#9d9185] hover:text-[#2a231d] text-sm">← Back</button>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-[#2a231d] tracking-tight mb-1">Trigger Campaign</h1>
        <p className="text-sm text-[#7f7266] mb-6">Send WhatsApp messages using your Meta-approved templates.</p>

        {/* Mode tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setMode('campaign'); setResult(null) }}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${mode === 'campaign' ? 'bg-[#2a231d] text-white' : 'bg-white border border-[#e4d7c5] text-[#5f5348] hover:bg-[#fffaf5]'}`}
          >
            Campaign Leads
          </button>
          <button
            onClick={() => { setMode('phones'); setResult(null) }}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${mode === 'phones' ? 'bg-[#2a231d] text-white' : 'bg-white border border-[#e4d7c5] text-[#5f5348] hover:bg-[#fffaf5]'}`}
          >
            Specific Numbers
          </button>
        </div>

        <div className="space-y-5">
          {/* ── CAMPAIGN MODE ── */}
          {mode === 'campaign' && (
            <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-3">Select Campaign</p>
              {campaigns.length === 0 ? (
                <p className="text-sm text-[#9d9185]">No campaigns found. Upload one first.</p>
              ) : (
                <div className="grid gap-2 max-h-64 overflow-y-auto">
                  {campaigns.map(c => (
                    <button key={c.id} onClick={() => { setSelectedCampaign(c); setCampaignTag(c.name) }}
                      className={`w-full text-left px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                        selectedCampaign?.id === c.id ? 'border-[#2a231d] bg-[#2a231d] text-white' : 'border-[#e4d7c5] bg-white text-[#2a231d] hover:border-[#c8b49a]'
                      }`}>
                      <span className="font-semibold">{c.name}</span>
                      <span className={`ml-2 text-xs ${selectedCampaign?.id === c.id ? 'text-[#d6b294]' : 'text-[#9d9185]'}`}>
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── PHONES MODE ── */}
          {mode === 'phones' && (
            <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-1">Phone Numbers</p>
              <p className="text-xs text-[#9d9185] mb-2">One per line or comma-separated. Country code required (91 for India).</p>
              <textarea
                value={phonesInput}
                onChange={e => setPhonesInput(e.target.value)}
                rows={4}
                placeholder={'919876543210\n918765432109\n919123456789'}
                className="w-full px-4 py-3 border border-[#e4d7c5] rounded-2xl text-sm font-mono bg-[#fffaf5] focus:outline-none focus:border-[#c8b49a] resize-none"
              />
              {parsedPhones.length > 0 && (
                <p className="text-xs text-green-700 mt-1 font-medium">{parsedPhones.length} number{parsedPhones.length > 1 ? 's' : ''} ready</p>
              )}
            </section>
          )}

          {/* ── TEMPLATE SELECTOR ── */}
          <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest mb-3">WhatsApp Template</p>

            {/* warning */}
            <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
              <span className="text-amber-500 text-xs mt-0.5">ℹ</span>
              <p className="text-xs text-amber-700">WhatsApp Rule: Free-form messages only deliver within 24h of user messaging you. For NEW numbers → use approved templates.</p>
            </div>

            {templatesError ? (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2">⚠ {templatesErrorMsg || 'Failed to load templates'}</p>
            ) : templatesLoading ? (
              <p className="text-sm text-[#9d9185]">Loading templates…</p>
            ) : templates.length === 0 ? (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">No templates found. Check WHATSAPP_TOKEN and WABA_ID on Render, or write a custom message below.</p>
            ) : (
              <>
                <div className="flex gap-3 mb-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold text-[#9d9185] uppercase tracking-widest block mb-1">Template Name</label>
                    <select
                      value={selectedTemplate?.id ?? ''}
                      onChange={e => {
                        const t = templates.find(t => t.id === e.target.value) ?? null
                        setSelectedTemplate(t)
                        setCustomMessage('')
                      }}
                      className="w-full px-3 py-2.5 border border-[#e4d7c5] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c8b49a]"
                    >
                      <option value="">— Select approved template —</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-32">
                    <label className="text-[10px] font-semibold text-[#9d9185] uppercase tracking-widest block mb-1">Language</label>
                    <select
                      value={language}
                      onChange={e => setLanguage(e.target.value)}
                      className="w-full px-3 py-2.5 border border-[#e4d7c5] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c8b49a]"
                    >
                      {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>
                </div>
                {selectedTemplate?.body && (
                  <p className="text-xs text-[#7f7266] bg-[#fffaf5] border border-[#e4d7c5] rounded-xl px-4 py-2.5 mb-3">{selectedTemplate.body}</p>
                )}
              </>
            )}

            <div>
              <label className="text-[10px] font-semibold text-[#9d9185] uppercase tracking-widest block mb-1">Variable {'{'}{'{'}'1{'}'}{'}'}  — Customer Name (optional)</label>
              <input
                value={variableName}
                onChange={e => setVariableName(e.target.value)}
                placeholder="e.g. Rahul  (same name sent to all — leave blank if template has no variables)"
                className="w-full px-4 py-2.5 border border-[#e4d7c5] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c8b49a]"
              />
            </div>

            <div className="mt-3">
              <label className="text-[10px] font-semibold text-[#9d9185] uppercase tracking-widest block mb-1">Or custom message</label>
              <textarea
                value={customMessage}
                onChange={e => { setCustomMessage(e.target.value); setSelectedTemplate(null) }}
                rows={3}
                placeholder="Hi {name}, following up on your interest in Krishna Aura…"
                className="w-full px-4 py-3 border border-[#e4d7c5] rounded-2xl text-sm bg-white focus:outline-none focus:border-[#c8b49a] resize-none"
              />
            </div>
          </section>

          {/* ── CAMPAIGN TAG (campaign mode) ── */}
          {mode === 'campaign' && (
            <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
              <label className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest block mb-2">Campaign Tag</label>
              <input value={campaignTag} onChange={e => setCampaignTag(e.target.value)}
                placeholder={selectedCampaign?.name ?? 'Day 1, Follow-up…'}
                className="w-full px-4 py-2.5 border border-[#e4d7c5] rounded-2xl text-sm bg-white focus:outline-none focus:border-[#c8b49a]" />
            </section>
          )}

          {mode === 'phones' && (
            <section className="bg-white border border-[#eadfce] rounded-3xl p-5 shadow-sm">
              <label className="text-xs font-semibold text-[#9d9185] uppercase tracking-widest block mb-2">Campaign Tag</label>
              <input value={broadcastTag} onChange={e => setBroadcastTag(e.target.value)}
                placeholder="Broadcast"
                className="w-full px-4 py-2.5 border border-[#e4d7c5] rounded-2xl text-sm bg-white focus:outline-none focus:border-[#c8b49a]" />
            </section>
          )}

          {/* ── SEND BUTTON ── */}
          {mode === 'campaign' ? (
            <button onClick={handleSendCampaign} disabled={!canSendCampaign}
              className="w-full py-3.5 rounded-full bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-all disabled:opacity-40 shadow-sm">
              {loading ? 'Sending…' : selectedCampaign ? `🚀 Send to all leads in "${selectedCampaign.name}"` : '🚀 Start Campaign'}
            </button>
          ) : (
            <button onClick={handleSendPhones} disabled={!canSendPhones}
              className="w-full py-3.5 rounded-full bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-all disabled:opacity-40 shadow-sm">
              {loading ? 'Sending…' : `📲 Send to ${parsedPhones.length} number${parsedPhones.length !== 1 ? 's' : ''}`}
            </button>
          )}

          {/* ── RESULTS ── */}
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
                  <p className="text-2xl font-bold text-gray-500">{result.skipped ?? 0}</p>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Skipped</p>
                </div>
              </div>
              {result.failed > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-500 mb-1">Failed deliveries</p>
                  {result.results.filter(r => r.status === 'failed').map((r, i) => (
                    <div key={i} className="text-xs text-[#7f7266] px-3 py-1.5 bg-red-50 rounded-lg">
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
