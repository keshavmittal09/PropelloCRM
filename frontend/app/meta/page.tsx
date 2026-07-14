'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { useMetaMarketingStats, useMetaCampaigns } from '@/hooks/useQueries'
import { formatCurrency, timeAgo } from '@/lib/utils'
import Sidebar from '@/components/shared/Sidebar'
import { MobileHeader } from '@/components/mobile/MobileHeader'

export default function MetaAdsDashboard() {
  const { agent } = useAuthStore()
  const router = useRouter()
  
  if (agent && agent.role !== 'admin') {
    router.push('/')
  }

  const { data: metaStats, isLoading: statsLoading } = useMetaMarketingStats()
  const { data: campaigns, isLoading: campaignsLoading } = useMetaCampaigns()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto crm-page-enter">
        <MobileHeader title="Meta Ads" subtitle="Marketing Performance" />
        
        <div className="p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[#2a231d]">Meta Ads Overview</h1>
            <p className="text-[#887d72] mt-1">Live synchronisation with your Meta Ads account.</p>
          </div>

          {/* Top Line Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-5 mb-10">
            <div className="crm-surface p-6 rounded-3xl">
              <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-1">Total Spend</p>
              <p className="text-3xl font-semibold text-[#0ea5e9]">
                {metaStats?.spend ? formatCurrency(metaStats.spend) : '₹0'}
              </p>
              <p className="text-[11px] font-medium text-[#9d9185] mt-1 tracking-[0.12em]">LAST 30 DAYS</p>
            </div>
            
            <div className="crm-surface p-6 rounded-3xl">
              <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-1">Impressions</p>
              <p className="text-3xl font-semibold text-[#0ea5e9]">
                {metaStats?.impressions?.toLocaleString() ?? 0}
              </p>
            </div>
            
            <div className="crm-surface p-6 rounded-3xl">
              <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-1">Link Clicks</p>
              <p className="text-3xl font-semibold text-[#0ea5e9]">
                {metaStats?.clicks?.toLocaleString() ?? 0}
              </p>
            </div>
            
            <div className="crm-surface p-6 rounded-3xl">
              <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-1">Avg. CPC</p>
              <p className="text-3xl font-semibold text-[#0ea5e9]">
                {metaStats?.cpc ? `₹${metaStats.cpc.toFixed(2)}` : '₹0'}
              </p>
            </div>

            <div className="crm-surface p-6 rounded-3xl">
              <p className="text-[11px] tracking-[0.16em] text-[#887d72] font-semibold uppercase mb-1">Avg. CTR</p>
              <p className="text-3xl font-semibold text-[#0ea5e9]">
                {metaStats?.ctr ? `${metaStats.ctr.toFixed(2)}%` : '0%'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4 mt-8">
            <h2 className="text-xl font-bold text-[#2a231d]">Campaign Performance</h2>
            <button
              onClick={() => router.push('/leads?source=facebook_ads')}
              className="text-sm text-blue-600 hover:underline font-medium"
            >
              View all Auto-synced Leads →
            </button>
          </div>

          <div className="crm-surface rounded-3xl overflow-hidden border border-[#eadfce]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fffdf9] border-b border-[#eadfce]">
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider">Campaign Name</th>
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider text-right">Status</th>
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider text-right">Spend</th>
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider text-right">Clicks</th>
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider text-right">CPC</th>
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider text-right">CRM Leads</th>
                  <th className="py-4 px-6 text-xs font-semibold text-[#8f8378] uppercase tracking-wider text-right">CPL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eadfce]">
                {campaignsLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-[#8f8378]">Syncing live campaign data...</td>
                  </tr>
                ) : campaigns?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-[#8f8378]">No active Meta campaigns synced yet. Data updates every 2 hours.</td>
                  </tr>
                ) : (
                  campaigns?.map(camp => (
                    <tr key={camp.id} className="hover:bg-[#fefaf4] transition-colors">
                      <td className="py-4 px-6">
                        <p className="font-medium text-[#2d261f] text-sm">{camp.name}</p>
                        <p className="text-xs text-[#9d9185] mt-1 font-mono">{camp.id}</p>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${camp.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {camp.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right font-medium text-[#463c32]">
                        {formatCurrency(camp.spend)}
                      </td>
                      <td className="py-4 px-6 text-right text-sm text-[#463c32]">
                        {camp.clicks.toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right text-sm text-[#463c32]">
                        ₹{camp.cpc.toFixed(2)}
                      </td>
                      <td className="py-4 px-6 text-right font-semibold text-[#a65630]">
                        {camp.leads.toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right text-sm text-[#a65630]">
                        {camp.cpl > 0 ? `₹${camp.cpl.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
        </div>
      </main>
    </div>
  )
}
