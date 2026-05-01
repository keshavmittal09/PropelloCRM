'use client'
import { useState } from 'react'
import { useMyLeads } from '@/hooks/useQueries'
import { MobileLeadCard } from '@/components/mobile/MobileLeadCard'
import { MobileHeader } from '@/components/mobile/MobileHeader'

export default function MobileMyLeadsPage() {
  const [search, setSearch] = useState('')
  const { data: leads, isLoading } = useMyLeads()

  const filtered = (leads ?? []).filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    const name = l.contact?.name?.toLowerCase() ?? ''
    const phone = l.contact?.phone ?? ''
    return name.includes(q) || phone.includes(q)
  })

  return (
    <div className="min-h-screen bg-[#f8f4ef] pb-20">
      <MobileHeader title="My Leads" subtitle={`${(leads ?? []).length} assigned`} showBack={false} />
      <div className="px-3 pt-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or phone..."
          className="w-full px-4 py-2.5 rounded-xl border border-[#e1d3c2] text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43] transition-all"
        />
      </div>

      {/* Lead list */}
      <div className="px-3 pt-3 space-y-2.5">
        {isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-2xl h-24 animate-pulse border border-[#e8ddcf]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-[#8f8378] font-medium">No leads assigned</p>
            <p className="text-xs text-[#b8a895] mt-1">Leads assigned to you will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(lead => (
              <MobileLeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
