'use client'
import { useEffect, useState } from 'react'
import { leadsApi } from '@/lib/api'

interface ChatMessage {
  id: string
  direction: string
  message: string
  sender_name: string | null
  timestamp: string
}

export default function WhatsAppChatsPanel({ leadId }: { leadId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    leadsApi.getWhatsAppChats(leadId)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false))
  }, [leadId])

  if (loading) return <p className="text-sm text-[#9d9185] py-4">Loading chats…</p>

  if (!messages.length) return (
    <div className="py-8 text-center">
      <p className="text-2xl mb-2">💬</p>
      <p className="text-sm font-medium text-[#5f5348]">No WhatsApp chats yet</p>
      <p className="text-xs text-[#9d9185] mt-1">Messages will appear here once the lead replies on WhatsApp.</p>
      <p className="text-xs text-[#b0a89e] mt-3">To enable: set <code className="bg-[#f3ede7] px-1 rounded">CRM_BASE_URL</code> on Railway to <code className="bg-[#f3ede7] px-1 rounded">https://propellocrm.onrender.com</code></p>
    </div>
  )

  return (
    <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto pr-1">
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
    </div>
  )
}
