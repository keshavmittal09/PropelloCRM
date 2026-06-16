'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Sidebar from '@/components/shared/Sidebar'
import { getWASupabase, type WALead, type WAConversation } from '@/lib/waSupabase'
import toast from 'react-hot-toast'

type LabelFilter = 'ALL' | 'HOT' | 'WARM' | 'COLD'
const PAGE_SIZE = 25

const TEMPLATES: Record<string, string> = {
  'Site Visit': 'Hi {name}, we would like to invite you for a site visit at our project. Please let us know your convenient time.',
  'Offer Alert': 'Hi {name}, we have a special offer available for you. Limited units at discounted prices. Interested?',
  'Follow Up': 'Hi {name}, just following up on your property inquiry. Are you still looking? We can help you find the right option.',
}

const labelStyle = (label: string) => {
  if (label === 'HOT') return 'border border-red-400 text-red-500 text-[11px] font-bold px-2 py-0.5 rounded'
  if (label === 'WARM') return 'border border-orange-400 text-orange-500 text-[11px] font-bold px-2 py-0.5 rounded'
  return 'border border-blue-400 text-blue-500 text-[11px] font-bold px-2 py-0.5 rounded'
}

const ScoreBar = ({ score }: { score: number }) => (
  <div className="flex items-center gap-2">
    <span className="text-sm font-medium text-gray-800 w-5">{score}</span>
    <div className="flex-1 h-1.5 bg-gray-200 rounded-full min-w-[80px]">
      <div
        className={`h-1.5 rounded-full ${score >= 7 ? 'bg-red-400' : score >= 4 ? 'bg-orange-400' : 'bg-blue-400'}`}
        style={{ width: `${Math.min(score * 10, 100)}%` }}
      />
    </div>
  </div>
)

function timeAgo(dateStr: string) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Broadcast Modal ──────────────────────────────────────────────────────────
function BroadcastModal({ counts, onClose }: { counts: Record<string, number>; onClose: () => void }) {
  const [tier, setTier] = useState<'HOT' | 'WARM' | 'COLD'>('HOT')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const applyTemplate = (name: string) => setMessage(TEMPLATES[name] ?? '')

  const handleSend = async () => {
    if (!message.trim() && files.length === 0) return toast.error('Add a message or attachment')
    setSending(true)
    try {
      // Fetch all phones for this tier
      const { data } = await getWASupabase()
        .from('leads')
        .select('phone')
        .eq('label', tier)
      const phones = (data ?? []).map((r: any) => r.phone).filter(Boolean)
      if (!phones.length) { toast.error('No leads in this tier'); setSending(false); return }

      if (files.length === 0) {
        // Text-only: use fast broadcast route
        const res = await fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones, message: message.trim(), campaign_tag: `WA-${tier}` }),
        })
        const json = await res.json()
        setResult({ sent: json.sent, failed: json.failed })
      } else {
        // With files: send text first (if any), then each file
        let sent = 0; let failed = 0
        if (message.trim()) {
          const res = await fetch('/api/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phones, message: message.trim(), campaign_tag: `WA-${tier}` }),
          })
          const j = await res.json()
          sent += j.sent; failed += j.failed
        }
        for (const file of files) {
          const fd = new FormData()
          fd.append('phones', phones.join(','))
          fd.append('message', `📎 ${file.name}`)
          fd.append('file', file)
          const res = await fetch('/api/wa-media', { method: 'POST', body: fd })
          const j = await res.json()
          sent += j.sent; failed += j.failed
        }
        setResult({ sent, failed })
      }
    } catch (e: any) {
      toast.error(e?.message || 'Broadcast failed')
    } finally {
      setSending(false)
    }
  }

  const tierLabel = (t: string) => `${t} (${counts[t] ?? 0})`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Broadcast Message</h2>
          <p className="text-xs text-gray-400 mt-0.5">Send WhatsApp to all leads in a tier</p>
        </div>

        {result ? (
          <div className="px-6 py-8 text-center">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-base font-semibold text-gray-800">Broadcast sent!</p>
            <p className="text-sm text-gray-500 mt-1">{result.sent} sent · {result.failed} failed</p>
            <button onClick={onClose} className="mt-4 px-6 py-2 bg-gray-900 text-white text-sm rounded-lg">Close</button>
          </div>
        ) : (
          <div className="px-6 py-5 flex flex-col gap-5">
            {/* Tier */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase mb-2">Target Tier</p>
              <div className="flex gap-2">
                {(['HOT', 'WARM', 'COLD'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTier(t)}
                    className={`px-4 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                      tier === t
                        ? t === 'HOT' ? 'bg-red-50 border-red-300 text-red-600'
                          : t === 'WARM' ? 'bg-orange-50 border-orange-300 text-orange-600'
                          : 'bg-blue-50 border-blue-300 text-blue-600'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {tierLabel(t)}
                  </button>
                ))}
              </div>
            </div>

            {/* Templates */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase mb-2">Templates</p>
              <div className="flex gap-2 flex-wrap">
                {Object.keys(TEMPLATES).map(name => (
                  <button
                    key={name}
                    onClick={() => applyTemplate(name)}
                    className="px-3 py-1.5 rounded-full border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase mb-2">
                Message — goes to {counts[tier] ?? 0} leads
              </p>
              <textarea
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Type your message here…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none"
              />
            </div>

            {/* Attachments */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase mb-2">
                Attachments (optional — sent to every lead)
              </p>
              {files.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-lg">
                      <span>📎 {f.name}</span>
                      <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="ml-auto text-gray-400 hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
              >
                📎 Attach File
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-1 border-t border-gray-100">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              <button
                onClick={handleSend}
                disabled={sending || (!message.trim() && files.length === 0)}
                className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending…' : `📤 Send Broadcast`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Chat Modal ───────────────────────────────────────────────────────────────
function ChatModal({ lead, onClose }: { lead: WALead; onClose: () => void }) {
  const [chats, setChats] = useState<WAConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getWASupabase()
      .from('conversations')
      .select('*')
      .eq('phone', lead.phone)
      .order('created_at', { ascending: true })
      .then(({ data }) => { setChats(data ?? []); setLoading(false) })
  }, [lead.phone])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chats])

  const handleSend = async () => {
    if (!text.trim() && !file) return
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('phones', lead.phone)
      if (text.trim()) fd.append('message', text.trim())
      if (file) fd.append('file', file)
      const res = await fetch('/api/wa-media', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.sent > 0) {
        toast.success('Sent!')
        const newMsg: WAConversation = { id: Date.now(), phone: lead.phone, role: 'assistant', message: text.trim() || `📎 ${file?.name}`, score: null, created_at: new Date().toISOString() }
        setChats(prev => [...prev, newMsg])
        setText(''); setFile(null)
      } else {
        toast.error('Failed: ' + (json.results?.[0]?.reason ?? 'unknown'))
      }
    } catch (e: any) { toast.error(e?.message) }
    finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[580px] mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-gray-900">{lead.name}</span>
              <span className={labelStyle(lead.label)}>{lead.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{lead.phone}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 px-6 py-4 border-b border-gray-100">
          {([
            ['SCORE', `${lead.score} / 10`],
            ['STATUS', lead.label],
            ['INTENT', lead.intent || '—'],
            ['MESSAGES', lead.message_count],
            ['FIRST SEEN', new Date(lead.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })],
            ['LAST ACTIVE', timeAgo(lead.last_message || lead.updated_at)],
          ] as [string, string | number][]).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wider mb-0.5">{k}</p>
              <p className={`text-sm font-medium ${k === 'SCORE' ? 'text-blue-600' : 'text-gray-800'}`}>{v}</p>
            </div>
          ))}
        </div>

        {(lead.budget_range || lead.location_preference || lead.campaign) && (
          <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">
            {lead.campaign && <span className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">{lead.campaign}</span>}
            {lead.location_preference && <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">📍 {lead.location_preference}</span>}
            {lead.budget_range && <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">💰 {lead.budget_range}</span>}
          </div>
        )}

        {/* Conversation */}
        <div className="px-6 pt-3 pb-1 flex items-center justify-between">
          <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">Conversation</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-2 min-h-0">
          {loading ? (
            <p className="text-sm text-gray-400 py-4">Loading chats…</p>
          ) : chats.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-sm text-gray-500">No conversation yet</p>
            </div>
          ) : chats.map(msg => {
            const isOut = msg.role === 'assistant'
            const time = new Date(msg.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            return (
              <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                  isOut ? 'bg-[#dcf8c6] text-[#1a1a1a] rounded-br-sm' : 'bg-white border border-[#ede4d8] text-[#2a231d] rounded-bl-sm'
                }`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                  <p className={`text-[10px] mt-1 text-right ${isOut ? 'text-[#7a9e6e]' : 'text-[#9d9185]'}`}>{time}</p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Send message */}
        <div className="px-6 pb-5 pt-3 border-t border-gray-100 flex flex-col gap-2">
          <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase">Send Message</p>
          <textarea
            rows={2}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type a follow-up message…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none"
          />
          {file && (
            <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-lg">
              <span>📎 {file.name}</span>
              <button onClick={() => setFile(null)} className="ml-auto text-gray-400 hover:text-red-400">✕</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50"
            >
              📎 Attach File
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <button
              onClick={handleSend}
              disabled={sending || (!text.trim() && !file)}
              className="ml-auto px-4 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WhatsAppLeadsPage() {
  const [leads, setLeads] = useState<WALead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState<LabelFilter>('ALL')
  const [selected, setSelected] = useState<WALead | null>(null)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [counts, setCounts] = useState({ HOT: 0, WARM: 0, COLD: 0, ALL: 0 })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchCounts = useCallback(async () => {
    const db = getWASupabase()
    const [all, hot, warm, cold] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('label', 'HOT'),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('label', 'WARM'),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('label', 'COLD'),
    ])
    setCounts({ ALL: all.count ?? 0, HOT: hot.count ?? 0, WARM: warm.count ?? 0, COLD: cold.count ?? 0 })
  }, [])

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    let q = getWASupabase()
      .from('leads')
      .select('*', { count: 'exact' })
      .order('score', { ascending: false })
      .range(from, to)
    if (labelFilter !== 'ALL') q = q.eq('label', labelFilter)
    if (search.trim()) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
    const { data, count } = await q
    setLeads(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [labelFilter, search, page])

  useEffect(() => { setPage(1) }, [labelFilter, search])
  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => { fetchCounts() }, [fetchCounts])

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const filterTabs: LabelFilter[] = ['ALL', 'HOT', 'WARM', 'COLD']
  const tabColor = (t: LabelFilter) => {
    if (t !== labelFilter) return 'text-gray-500 hover:text-gray-800 border-transparent'
    if (t === 'HOT') return 'bg-red-50 text-red-600 border-red-200'
    if (t === 'WARM') return 'bg-orange-50 text-orange-600 border-orange-200'
    if (t === 'COLD') return 'bg-blue-50 text-blue-600 border-blue-200'
    return 'bg-gray-100 text-gray-800 border-gray-200'
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">💬 WhatsApp Leads</h1>
            <p className="text-sm text-gray-500 mt-0.5">{counts.ALL} total from WhatsApp bot</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBroadcast(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700"
            >
              📤 Broadcast
            </button>
            <button
              onClick={() => { fetchLeads(); fetchCounts() }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="px-8 py-6">
          <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
            <input
              type="text"
              placeholder="Search name or phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 w-64"
            />
            <div className="flex items-center gap-2">
              {filterTabs.map(t => (
                <button key={t} onClick={() => setLabelFilter(t)} className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${tabColor(t)}`}>
                  {t} ({counts[t]})
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['NAME', 'PHONE', 'SCORE', 'STATUS', 'CAMPAIGN', 'INTENT', 'MSGS', 'LAST ACTIVE'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-400 tracking-wider px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No leads found</td></tr>
                ) : leads.map(lead => (
                  <tr key={lead.id} onClick={() => setSelected(lead)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{lead.name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{lead.phone}</td>
                    <td className="px-4 py-3 min-w-[140px]"><ScoreBar score={lead.score} /></td>
                    <td className="px-4 py-3"><span className={labelStyle(lead.label)}>{lead.label}</span></td>
                    <td className="px-4 py-3">
                      {lead.campaign ? <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full">{lead.campaign}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{lead.intent || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{lead.message_count}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(lead.last_message || lead.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                <p className="text-xs text-gray-500">
                  Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
                    ← Prev
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                    const p = start + i
                    return p <= totalPages ? (
                      <button key={p} onClick={() => setPage(p)}
                        className={`px-3 py-1.5 text-xs rounded border ${page === p ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-white'}`}>
                        {p}
                      </button>
                    ) : null
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {selected && <ChatModal lead={selected} onClose={() => setSelected(null)} />}
      {showBroadcast && <BroadcastModal counts={counts} onClose={() => setShowBroadcast(false)} />}
    </div>
  )
}
