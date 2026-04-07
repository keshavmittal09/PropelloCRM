'use client'

interface SourceStat {
  source: string
  count: number
  won: number
  conversion_rate: number
}

const sourceLabels: Record<string, { label: string; color: string; icon: string }> = {
  priya_ai: { label: 'Priya AI', color: '#8B5CF6', icon: '🤖' },
  website: { label: 'Website', color: '#3B82F6', icon: '🌐' },
  facebook_ads: { label: 'Facebook', color: '#1877F2', icon: '📘' },
  google_ads: { label: 'Google Ads', color: '#EA4335', icon: '🔍' },
  '99acres': { label: '99acres', color: '#FF6600', icon: '🏠' },
  magicbricks: { label: 'MagicBricks', color: '#E74C3C', icon: '🧱' },
  walk_in: { label: 'Walk-in', color: '#10B981', icon: '🚶' },
  referral: { label: 'Referral', color: '#F59E0B', icon: '🤝' },
  email_campaign: { label: 'Email', color: '#06B6D4', icon: '✉️' },
  manual: { label: 'Manual', color: '#6B7280', icon: '✏️' },
}

export default function LeadSourceChart({ data }: { data: SourceStat[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-[15px] text-gray-900 tracking-tight mb-4">Lead Sources</h3>
        <p className="text-sm text-gray-400 text-center py-6">No lead data yet</p>
      </div>
    )
  }

  const total = data.reduce((sum, d) => sum + d.count, 0) || 1

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-[15px] text-gray-900 tracking-tight">Lead Sources</h3>
        <span className="text-xs text-gray-400 font-medium">{total} total</span>
      </div>

      {/* Visual bar chart */}
      <div className="space-y-3">
        {data
          .sort((a, b) => b.count - a.count)
          .map((stat) => {
            const info = sourceLabels[stat.source] || { label: stat.source, color: '#6B7280', icon: '📌' }
            const pct = Math.round((stat.count / total) * 100)

            return (
              <div key={stat.source}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{info.icon}</span>
                    <span className="text-sm font-medium text-gray-700">{info.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{stat.count} leads</span>
                    <span className="text-xs font-semibold text-gray-700">{pct}%</span>
                  </div>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: info.color }}
                  />
                </div>
                {stat.won > 0 && (
                  <p className="text-[11px] text-gray-400 mt-0.5 ml-7">
                    {stat.won} won · {stat.conversion_rate}% conversion
                  </p>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
