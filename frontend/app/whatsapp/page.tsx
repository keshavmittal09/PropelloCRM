'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/shared/Sidebar'
import { getWASupabase, type WALead, type WAConversation } from '@/lib/waSupabase'

type LabelFilter = 'ALL' | 'HOT' | 'WARM' | 'COLD'

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
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function ChatModal({ lead, onClose }: { lead: WALead; onClose: () => void }) {
  const [chats, setChats] = useState<WAConversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getWASupabase()
      .from('conversations')
      .select('*')
      .eq('phone', lead.phone)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setChats(data ?? [])
        setLoading(false)
      })
  }, [lead.phone])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[580px] mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
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
          {[
            ['SCORE', `${lead.score} / 10`],
            ['STATUS', lead.label],
            ['INTENT', lead.intent || '—'],
            ['MESSAGES', lead.message_count],
            ['FIRST SEEN', new Date(lead.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })],
            ['LAST ACTIVE', timeAgo(lead.last_message || lead.updated_at)],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 tracking-wider mb-0.5">{k}</p>
              <p className={`text-sm font-medium ${k === 'SCORE' ? 'text-blue-600' : 'text-gray-800'}`}>{v}</p>
            </div>
          ))}
        </div>

        {/* Extra details */}
        {(lead.budget_range || lead.location_preference || lead.campaign) && (
          <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">
            {lead.campaign && (
              <span className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">{lead.campaign}</span>
            )}
            {lead.location_preference && (
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">📍 {lead.location_preference}</span>
            )}
            {lead.budget_range && (
              <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">💰 {lead.budget_range}</span>
            )}
          </div>
        )}

        {/* Conversation */}
        <div className="px-6 pt-3 pb-1">
          <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">Conversation</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-2 min-h-0">
          {loading ? (
            <p className="text-sm text-gray-400 py-4">Loading chats…</p>
          ) : chats.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-sm text-gray-500">No conversation found</p>
            </div>
          ) : (
            chats.map(msg => {
              const isOut = msg.role === 'assistant'
              const time = new Date(msg.created_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })
              return (
                <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                    isOut
                      ? 'bg-[#dcf8c6] text-[#1a1a1a] rounded-br-sm'
                      : 'bg-white border border-[#ede4d8] text-[#2a231d] rounded-bl-sm'
                  }`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                    <p className={`text-[10px] mt-1 text-right ${isOut ? 'text-[#7a9e6e]' : 'text-[#9d9185]'}`}>{time}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default function WhatsAppLeadsPage() {
  const [leads, setLeads] = useState<WALead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState<LabelFilter>('ALL')
  const [selected, setSelected] = useState<WALead | null>(null)
  const [counts, setCounts] = useState({ HOT: 0, WARM: 0, COLD: 0, ALL: 0 })

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    let q = getWASupabase().from('leads').select('*').order('score', { ascending: false })
    if (labelFilter !== 'ALL') q = q.eq('label', labelFilter)
    if (search.trim()) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
    const { data } = await q
    setLeads(data ?? [])
    setLoading(false)
  }, [labelFilter, search])

  const fetchCounts = useCallback(async () => {
    const { data } = await getWASupabase().from('leads').select('label')
    if (!data) return
    const c = { HOT: 0, WARM: 0, COLD: 0, ALL: data.length }
    data.forEach(r => { if (r.label in c) c[r.label as 'HOT' | 'WARM' | 'COLD']++ })
    setCounts(c)
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])
  useEffect(() => { fetchCounts() }, [fetchCounts])

  const filterTabs: LabelFilter[] = ['ALL', 'HOT', 'WARM', 'COLD']
  const tabColor = (t: LabelFilter) => {
    if (t !== labelFilter) return 'text-gray-500 hover:text-gray-800'
    if (t === 'HOT') return 'bg-red-50 text-red-600 border-red-200'
    if (t === 'WARM') return 'bg-orange-50 text-orange-600 border-orange-200'
    if (t === 'COLD') return 'bg-blue-50 text-blue-600 border-blue-200'
    return 'bg-gray-100 text-gray-800 border-gray-200'
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span>💬</span> WhatsApp Leads
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{counts.ALL} total from WhatsApp bot</p>
          </div>
          <button
            onClick={fetchLeads}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
          >
            ↻ Refresh
          </button>
        </div>

        <div className="px-8 py-6">
          {/* Search + filter row */}
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
                <button
                  key={t}
                  onClick={() => setLabelFilter(t)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${tabColor(t)}`}
                >
                  {t} ({counts[t]})
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
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
                ) : (
                  leads.map(lead => (
                    <tr
                      key={lead.id}
                      onClick={() => setSelected(lead)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{lead.name || 'Unknown'}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{lead.phone}</td>
                      <td className="px-4 py-3 min-w-[140px]"><ScoreBar score={lead.score} /></td>
                      <td className="px-4 py-3"><span className={labelStyle(lead.label)}>{lead.label}</span></td>
                      <td className="px-4 py-3">
                        {lead.campaign
                          ? <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full">{lead.campaign}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{lead.intent || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{lead.message_count}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(lead.last_message || lead.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {selected && <ChatModal lead={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
