'use client'

interface FollowUpItem {
  id: string
  channel: string
  template: string | null
  scheduled_at: string
  executed_at: string | null
  status: string
  triggered_by: string
}

const channelIcons: Record<string, string> = {
  whatsapp: '📱',
  email: '✉️',
  call: '📞',
  in_app: '🔔',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600 border-amber-200',
  sent: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  failed: 'bg-red-50 text-red-600 border-red-200',
  cancelled: 'bg-gray-50 text-gray-400 border-gray-200',
}

export default function FollowUpTimeline({ followups }: { followups: FollowUpItem[] }) {
  if (!followups || followups.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">⏱️</span>
          <h3 className="font-semibold text-[15px] text-gray-900 tracking-tight">Follow-up Timeline</h3>
        </div>
        <p className="text-sm text-gray-400 text-center py-6">No follow-ups scheduled</p>
      </div>
    )
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-lg">⏱️</span>
        <h3 className="font-semibold text-[15px] text-gray-900 tracking-tight">Follow-up Timeline</h3>
        <span className="ml-auto text-xs text-gray-400 font-medium">{followups.length} total</span>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />

        <div className="space-y-4">
          {followups.map((fu) => (
            <div key={fu.id} className="relative flex items-start gap-4 pl-10">
              {/* Dot on line */}
              <div className={`absolute left-[11px] top-2 w-[10px] h-[10px] rounded-full border-2 ${
                fu.status === 'sent' ? 'bg-emerald-400 border-emerald-400' :
                fu.status === 'pending' ? 'bg-amber-400 border-amber-400' :
                fu.status === 'failed' ? 'bg-red-400 border-red-400' :
                'bg-gray-300 border-gray-300'
              }`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm">{channelIcons[fu.channel] || '📌'}</span>
                  <span className="text-sm font-medium text-gray-800 capitalize">
                    {fu.channel}
                  </span>
                  {fu.template && (
                    <span className="text-xs text-gray-400">
                      ({fu.template.replace(/_/g, ' ')})
                    </span>
                  )}
                  <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusStyles[fu.status] || ''}`}>
                    {fu.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-400">
                    {fu.status === 'sent' && fu.executed_at
                      ? `Sent ${formatDate(fu.executed_at)}`
                      : `Scheduled ${formatDate(fu.scheduled_at)}`
                    }
                  </span>
                  <span className="text-xs text-gray-300">•</span>
                  <span className="text-xs text-gray-400 capitalize">
                    {fu.triggered_by.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
