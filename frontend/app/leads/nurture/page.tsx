'use client'
import { useState } from 'react'
import Sidebar from '@/components/shared/Sidebar'
import { useLeads } from '@/hooks/useQueries'
import { leadsApi } from '@/lib/api'
import { formatDateTime, timeAgo } from '@/lib/utils'
import { ScoreBadge } from '@/components/shared/Badges'
import toast from 'react-hot-toast'
import type { Lead } from '@/lib/types'

export default function NurturePage() {
  const { data: leads, isLoading } = useLeads({ stage: 'nurture' })
  // Sort by days since last contact (oldest first)
  const sortedLeads = leads ? [...leads].sort((a, b) => {
    const aTime = a.last_contacted_at ? new Date(a.last_contacted_at).getTime() : 0
    const bTime = b.last_contacted_at ? new Date(b.last_contacted_at).getTime() : 0
    return aTime - bTime
  }) : []

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Re-engagement Queue</h2>
          <p className="text-gray-500 mt-1">Leads that need follow-up (Nurture stage)</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" /></div>
        ) : !sortedLeads.length ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No leads currently require re-engagement.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {sortedLeads.map(lead => (
              <NurtureCard key={lead.id} lead={lead} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function NurtureCard({ lead }: { lead: Lead }) {
  const [sending, setSending] = useState(false)
  const contactName = lead.contact?.name ?? 'Client'

  // Pre-filled WhatsApp message
  const [message, setMessage] = useState(
    `Hi ${contactName}, this is ${lead.assigned_agent?.name || 'Propello CRM'}. Just checking in — have you had a chance to think about the properties we discussed? Happy to answer any questions or show you some new listings in your range.`
  )

  const sendWhatsApp = async () => {
    setSending(true)
    try {
      await leadsApi.sendWhatsApp(lead.id, 'general_followup', message)
      toast.success('Follow-up message sent!')
    } catch {
      toast.error('Failed to send WhatsApp message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-indigo-200 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{contactName}</h3>
          <p className="text-sm text-gray-500">{lead.contact?.phone}</p>
        </div>
        <ScoreBadge score={lead.lead_score} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-gray-400 mb-4">
        <span>Last Contacted: <span className="text-gray-600 font-medium">{lead.last_contacted_at ? timeAgo(lead.last_contacted_at) : 'Never'}</span> ({lead.last_contacted_at ? formatDateTime(lead.last_contacted_at) : 'N/A'})</span>
        {lead.lost_reason && <span>Prior Reason: <span className="text-gray-600 font-medium">{lead.lost_reason}</span></span>}
        {lead.priya_memory_brief && <p className="text-gray-500 mt-2 line-clamp-2 border-l-2 border-gray-200 pl-2 italic">"{lead.priya_memory_brief}"</p>}
      </div>

      <div className="space-y-2 mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Suggested Message (Editable)</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50 text-gray-700"
        />
      </div>

      <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
        <button
          onClick={sendWhatsApp}
          disabled={sending || !message.trim()}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-green-700 transition-colors flex items-center gap-2"
        >
          {sending ? 'Sending...' : 'Send WhatsApp Follow-up'}
        </button>
      </div>
    </div>
  )
}
