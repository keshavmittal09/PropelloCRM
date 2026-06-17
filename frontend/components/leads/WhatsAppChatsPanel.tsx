'use client'
import { useEffect, useRef, useState } from 'react'
import { leadsApi } from '@/lib/api'
import { getWASupabase } from '@/lib/waSupabase'
import toast from 'react-hot-toast'

interface ChatMessage {
  id: string
  direction: string
  message: string
  sender_name: string | null
  timestamp: string
}

interface Props {
  leadId: string
  phone?: string | null
}

export default function WhatsAppChatsPanel({ leadId, phone }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadChats = async () => {
    // 1. Try the main backend first
    try {
      const data = await leadsApi.getWhatsAppChats(leadId)
      if (data?.length) {
        setMessages(data)
        setLoading(false)
        return
      }
    } catch { /* backend has no chats – fall through */ }

    // 2. Fallback: query the WhatsApp Supabase by phone number
    if (phone) {
      try {
        const { data } = await getWASupabase()
          .from('conversations')
          .select('*')
          .eq('phone', phone.replace(/[\s\-\+]/g, ''))
          .order('created_at', { ascending: true })

        if (data?.length) {
          setMessages(
            data.map((r: any) => ({
              id: String(r.id),
              direction: r.role === 'assistant' ? 'outbound' : 'inbound',
              message: r.message,
              sender_name: null,
              timestamp: r.created_at,
            }))
          )
          setLoading(false)
          return
        }
      } catch { /* supabase also failed */ }
    }

    setLoading(false)
  }

  useEffect(() => { loadChats() }, [leadId, phone])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = async () => {
    if (!phone) return toast.error('No phone number for this lead')
    if (!text.trim() && !file) return
    if (file && file.size > 4 * 1024 * 1024) return toast.error('File too large — max 4 MB')
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('phones', phone)
      if (text.trim()) fd.append('message', text.trim())
      if (file) fd.append('file', file)
      const res = await fetch('/api/wa-media', { method: 'POST', body: fd })
      const raw = await res.text()
      let json: any
      try { json = JSON.parse(raw) } catch { throw new Error(res.ok ? 'Server error' : `HTTP ${res.status}`) }
      if (json.sent > 0) {
        toast.success('Message sent!')
        setText('')
        setFile(null)
        // optimistically append
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          direction: 'outbound',
          message: text.trim() || `📎 ${file?.name}`,
          sender_name: null,
          timestamp: new Date().toISOString(),
        }])
      } else {
        toast.error('Send failed: ' + (json.error || json.results?.[0]?.reason || 'Unknown error'))
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <p className="text-sm text-[#9d9185] py-4">Loading chats…</p>

  if (!messages.length) return (
    <div className="flex flex-col gap-4">
      <div className="py-8 text-center">
        <p className="text-2xl mb-2">💬</p>
        <p className="text-sm font-medium text-[#5f5348]">No WhatsApp chats yet</p>
        <p className="text-xs text-[#9d9185] mt-1">Messages will appear here once the lead replies on WhatsApp.</p>
      </div>
      {phone && <SendBox text={text} setText={setText} file={file} setFile={setFile} fileRef={fileRef} sending={sending} onSend={handleSend} />}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
        {messages.map(m => {
          const isOut = m.direction === 'outbound'
          const time = new Date(m.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          return (
            <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                isOut
                  ? 'bg-[#dcf8c6] text-[#1a1a1a] rounded-br-sm'
                  : 'bg-white border border-[#ede4d8] text-[#2a231d] rounded-bl-sm'
              }`}>
                {!isOut && m.sender_name && (
                  <p className="text-[10px] font-semibold text-green-600 mb-0.5">{m.sender_name}</p>
                )}
                <p className="leading-relaxed whitespace-pre-wrap">{m.message}</p>
                <p className={`text-[10px] mt-1 text-right ${isOut ? 'text-[#7a9e6e]' : 'text-[#9d9185]'}`}>{time}</p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {phone && <SendBox text={text} setText={setText} file={file} setFile={setFile} fileRef={fileRef} sending={sending} onSend={handleSend} />}
    </div>
  )
}

function SendBox({ text, setText, file, setFile, fileRef, sending, onSend }: {
  text: string
  setText: (v: string) => void
  file: File | null
  setFile: (f: File | null) => void
  fileRef: React.RefObject<HTMLInputElement>
  sending: boolean
  onSend: () => void
}) {
  return (
    <div className="border-t border-[#e8ddd4] pt-3 mt-1">
      <p className="text-[10px] font-semibold text-[#9d9185] tracking-widest uppercase mb-2">Send Message</p>
      <textarea
        rows={3}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type a follow-up message…"
        className="w-full border border-[#e8ddd4] rounded-xl px-3 py-2.5 text-sm text-[#2a231d] placeholder-[#b8a895] focus:outline-none focus:ring-2 focus:ring-[#c9a882]/40 resize-none bg-white"
      />
      {file && (
        <div className="flex items-center gap-2 mt-2 text-xs text-[#5f5348] bg-[#f5ede5] px-3 py-2 rounded-lg">
          <span>📎 {file.name}</span>
          <button onClick={() => setFile(null)} className="ml-auto text-[#b8a895] hover:text-red-400">✕</button>
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e0d4c8] text-xs text-[#7b7166] hover:bg-[#f5ede5] transition-colors"
        >
          📎 Attach File
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx"
          className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={onSend}
          disabled={sending || (!text.trim() && !file)}
          className="ml-auto px-4 py-1.5 rounded-lg bg-[#2a231e] text-white text-xs font-semibold hover:bg-[#3d332b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
