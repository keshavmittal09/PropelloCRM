'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import Sidebar from '@/components/shared/Sidebar'
import { MobileHeader } from '@/components/mobile/MobileHeader'
import { bulkTasksApi, authApi } from '@/lib/api'
import toast from 'react-hot-toast'
import type { BulkTaskIngest, BulkTaskIngestDetail, BulkTaskRecord, Agent } from '@/lib/types'

const HEAT_COLORS: Record<string, string> = {
  hot: 'bg-red-100 text-red-700 border-red-200',
  warm: 'bg-amber-100 text-amber-700 border-amber-200',
  cold: 'bg-blue-100 text-blue-700 border-blue-200',
}

function HeatBadge({ heat }: { heat: string | null }) {
  const h = (heat || 'warm').toLowerCase()
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${HEAT_COLORS[h] || HEAT_COLORS.warm}`}>
      {h === 'hot' ? '🔥' : h === 'cold' ? '❄️' : '🌤️'} {h.charAt(0).toUpperCase() + h.slice(1)}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ingested: 'bg-emerald-100 text-emerald-700',
    skipped: 'bg-gray-100 text-gray-500',
    failed: 'bg-red-100 text-red-600',
    pending: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  )
}

export default function BulkTasksPage() {
  const { agent } = useAuthStore()
  const router = useRouter()
  const [batches, setBatches] = useState<BulkTaskIngest[]>([])
  const [selectedBatch, setSelectedBatch] = useState<BulkTaskIngestDetail | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set())
  const [assignAgent, setAssignAgent] = useState('')
  const [callerFilter, setCallerFilter] = useState('')
  const [heatFilter, setHeatFilter] = useState('')
  const [assigning, setAssigning] = useState(false)

  const isAdmin = agent?.role === 'admin' || agent?.role === 'manager'

  const loadBatches = useCallback(async () => {
    try {
      const data = await bulkTasksApi.listBatches()
      setBatches(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    loadBatches()
    authApi.listAgents().then(setAgents).catch(() => {})
  }, [isAdmin, loadBatches])

  const handleUpload = async () => {
    if (!file || !batchName.trim()) {
      toast.error('Please provide a batch name and select a file')
      return
    }
    setUploading(true)
    try {
      const result = await bulkTasksApi.upload(file, batchName.trim())
      toast.success(`Uploaded! ${result.total_records} records processed (${result.hot_count} hot, ${result.warm_count} warm, ${result.cold_count} cold)`)
      setBatchName('')
      setFile(null)
      loadBatches()
      loadBatch(result.id)
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const loadBatch = async (id: string) => {
    setLoading(true)
    try {
      const data = await bulkTasksApi.getBatch(id, {
        caller_name: callerFilter || undefined,
        heat: heatFilter || undefined,
        limit: 200,
      })
      setSelectedBatch(data)
      setSelectedRecords(new Set())
    } catch { toast.error('Failed to load batch') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (selectedBatch?.id) loadBatch(selectedBatch.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerFilter, heatFilter])

  const handleBulkAssign = async () => {
    if (!selectedBatch || !assignAgent) return
    if (selectedRecords.size === 0) { toast.error('Select records first'); return }
    setAssigning(true)
    try {
      const res = await bulkTasksApi.bulkAssign(selectedBatch.id, {
        record_ids: Array.from(selectedRecords),
        agent_id: assignAgent,
      })
      toast.success(`Assigned ${res.assigned} records to ${res.agent_name}`)
      loadBatch(selectedBatch.id)
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Assignment failed') }
    finally { setAssigning(false) }
  }

  const handleAssignByCaller = async (callerName: string) => {
    if (!selectedBatch || !assignAgent) { toast.error('Select an agent first'); return }
    setAssigning(true)
    try {
      const res = await bulkTasksApi.assignByCaller(selectedBatch.id, {
        caller_name: callerName,
        agent_id: assignAgent,
      })
      toast.success(`Assigned ${res.assigned} records (${callerName}) to ${res.agent_name}`)
      loadBatch(selectedBatch.id)
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Assignment failed') }
    finally { setAssigning(false) }
  }

  const handleExport = (batchId: string) => {
    const token = localStorage.getItem('propello_token')
    const url = `${bulkTasksApi.exportBatch(batchId)}?token=${token}`
    window.open(url, '_blank')
  }

  const handleExportAll = () => {
    const token = localStorage.getItem('propello_token')
    const url = `${bulkTasksApi.exportAll()}?token=${token}`
    window.open(url, '_blank')
  }

  const toggleRecord = (id: string) => {
    setSelectedRecords(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (!selectedBatch) return
    if (selectedRecords.size === selectedBatch.records.length) {
      setSelectedRecords(new Set())
    } else {
      setSelectedRecords(new Set(selectedBatch.records.map(r => r.id)))
    }
  }

  const handleDeleteBatch = async (id: string) => {
    if (!confirm('Delete this batch? (Leads and tasks created from it will NOT be deleted)')) return
    try {
      await bulkTasksApi.deleteBatch(id)
      toast.success('Batch deleted')
      if (selectedBatch?.id === id) setSelectedBatch(null)
      loadBatches()
    } catch { toast.error('Failed to delete') }
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-[#8f8378]">Admin/Manager access required</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto crm-page-enter">
        <MobileHeader title="Bulk Task Ingest" subtitle="Upload CSV & assign tasks" />

        <div className="mb-8 mt-4 px-2">
          <h2 className="text-4xl font-semibold tracking-tight text-[#1f1914]">Bulk Task Ingest</h2>
          <p className="text-[#756c63] font-medium tracking-wide text-sm mt-2">
            Upload CSV call data, categorize by lead heat, and assign tasks to agents in bulk.
          </p>
        </div>

        {/* Upload Section */}
        <div className="crm-surface rounded-2xl p-6 mb-6">
          <h3 className="font-semibold text-[#2a231d] mb-4">📤 Upload CSV / Excel File</h3>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="text-xs text-[#887d72] font-semibold uppercase tracking-wider mb-1 block">Batch Name</label>
              <input
                value={batchName}
                onChange={e => setBatchName(e.target.value)}
                placeholder="e.g. May 6 - Evening Calls"
                className="w-full px-4 py-2.5 border border-[#e5d7c5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#be6a3f]/30"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#887d72] font-semibold uppercase tracking-wider mb-1 block">CSV/Excel File</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-2 border border-[#e5d7c5] rounded-xl text-sm file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#f7ede5] file:text-[#8f4d2a] hover:file:bg-[#f0dfd2]"
              />
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading || !file || !batchName.trim()}
              className="px-6 py-2.5 bg-[#be6a3f] hover:bg-[#a95d36] text-white rounded-full text-sm font-semibold transition-all shadow-lg disabled:opacity-50 whitespace-nowrap"
            >
              {uploading ? '⏳ Processing...' : '🚀 Upload & Ingest'}
            </button>
          </div>
        </div>

        {/* Admin Export Button */}
        <div className="flex justify-end mb-4 px-2">
          <button
            onClick={handleExportAll}
            className="px-5 py-2 bg-[#2f2317] hover:bg-[#1a150e] text-white rounded-full text-sm font-semibold transition-all shadow-md flex items-center gap-2"
          >
            📥 Export All Leads (CSV)
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Batch List */}
          <div className="crm-surface rounded-2xl p-5">
            <h3 className="font-semibold text-[#2a231d] mb-3">📋 Upload Batches</h3>
            {batches.length === 0 ? (
              <p className="text-sm text-[#8f8378] text-center py-8">No batches yet. Upload a CSV above.</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {batches.map(b => (
                  <div
                    key={b.id}
                    onClick={() => loadBatch(b.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${selectedBatch?.id === b.id
                      ? 'border-[#be6a3f] bg-[#fdf5ef] shadow-sm'
                      : 'border-[#eadfce] bg-[#fffdf9] hover:border-[#dcc9b3]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-[#2d261f] truncate">{b.batch_name}</p>
                      <div className="flex gap-1">
                        <button onClick={e => { e.stopPropagation(); handleExport(b.id) }}
                          className="text-xs px-2 py-0.5 rounded bg-[#f0e4d8] text-[#6e5540] hover:bg-[#e5d4c3]">📥</button>
                        <button onClick={e => { e.stopPropagation(); handleDeleteBatch(b.id) }}
                          className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-500 hover:bg-red-100">🗑</button>
                      </div>
                    </div>
                    <p className="text-xs text-[#8f8378] mt-1">{b.total_records} records • {b.file_name}</p>
                    <div className="flex gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">🔥 {b.hot_count}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">🌤️ {b.warm_count}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">❄️ {b.cold_count}</span>
                    </div>
                    <p className="text-xs text-[#afa499] mt-1">{b.created_leads} leads • {b.created_tasks} tasks created</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Batch Detail + Records */}
          <div className="xl:col-span-2">
            {!selectedBatch ? (
              <div className="crm-surface rounded-2xl p-10 text-center">
                <p className="text-lg text-[#8f8378]">Select a batch to view records</p>
                <p className="text-sm text-[#afa499] mt-2">Upload a CSV file or click on an existing batch.</p>
              </div>
            ) : loading ? (
              <div className="crm-surface rounded-2xl p-10 text-center">
                <p className="text-[#8f8378] animate-pulse">Loading batch data...</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Batch Summary */}
                <div className="crm-surface rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-[#2a231d] text-lg">{selectedBatch.batch_name}</h3>
                    <button onClick={() => handleExport(selectedBatch.id)}
                      className="px-4 py-1.5 bg-[#2f2317] text-white rounded-full text-xs font-semibold hover:bg-[#1a150e] transition-all flex items-center gap-1.5">
                      📥 Download CSV
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-[#faf7f2] border border-[#eadfce]">
                      <p className="text-xs text-[#887d72] font-semibold uppercase">Total</p>
                      <p className="text-2xl font-bold text-[#2d261f]">{selectedBatch.total_records}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-red-50 border border-red-100">
                      <p className="text-xs text-red-500 font-semibold uppercase">🔥 Hot</p>
                      <p className="text-2xl font-bold text-red-700">{selectedBatch.hot_count}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                      <p className="text-xs text-amber-500 font-semibold uppercase">🌤️ Warm</p>
                      <p className="text-2xl font-bold text-amber-700">{selectedBatch.warm_count}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
                      <p className="text-xs text-blue-500 font-semibold uppercase">❄️ Cold</p>
                      <p className="text-2xl font-bold text-blue-700">{selectedBatch.cold_count}</p>
                    </div>
                  </div>
                </div>

                {/* Caller Tabs + Assignment */}
                <div className="crm-surface rounded-2xl p-5">
                  <h4 className="font-semibold text-[#2a231d] mb-3">👥 Callers / Tabs — Bulk Assign</h4>
                  <div className="flex flex-wrap gap-3 items-end mb-4">
                    <div>
                      <label className="text-xs text-[#887d72] font-semibold uppercase mb-1 block">Assign To Agent</label>
                      <select
                        value={assignAgent}
                        onChange={e => setAssignAgent(e.target.value)}
                        className="px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm min-w-[180px]"
                      >
                        <option value="">Select agent...</option>
                        {agents.filter(a => a.role !== 'admin').map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={handleBulkAssign}
                      disabled={assigning || !assignAgent || selectedRecords.size === 0}
                      className="px-5 py-2 bg-[#be6a3f] hover:bg-[#a95d36] text-white rounded-full text-sm font-semibold transition-all disabled:opacity-50"
                    >
                      {assigning ? 'Assigning...' : `Assign ${selectedRecords.size} Selected`}
                    </button>
                  </div>
                  {selectedBatch.caller_names && selectedBatch.caller_names.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedBatch.caller_names.map(name => (
                        <div key={name} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#eadfce] bg-[#faf7f2]">
                          <span className="text-sm font-medium text-[#2d261f]">{name}</span>
                          <button
                            onClick={() => handleAssignByCaller(name)}
                            disabled={assigning || !assignAgent}
                            className="text-xs px-2.5 py-1 rounded-full bg-[#be6a3f] text-white font-semibold hover:bg-[#a95d36] disabled:opacity-50 transition-all"
                          >
                            Assign All
                          </button>
                          <button
                            onClick={() => setCallerFilter(callerFilter === name ? '' : name)}
                            className={`text-xs px-2 py-1 rounded-full border transition-all ${callerFilter === name ? 'bg-[#2f2317] text-white border-[#2f2317]' : 'bg-white text-[#6e5540] border-[#dcc9b3] hover:bg-[#f7ede5]'}`}
                          >
                            Filter
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Filters */}
                <div className="flex gap-3 px-1">
                  <select value={heatFilter} onChange={e => setHeatFilter(e.target.value)}
                    className="px-3 py-2 border border-[#e5d7c5] rounded-xl text-sm">
                    <option value="">All Heat Levels</option>
                    <option value="hot">🔥 Hot</option>
                    <option value="warm">🌤️ Warm</option>
                    <option value="cold">❄️ Cold</option>
                  </select>
                  {(callerFilter || heatFilter) && (
                    <button onClick={() => { setCallerFilter(''); setHeatFilter('') }}
                      className="text-xs text-[#a65630] hover:underline">Clear filters</button>
                  )}
                </div>

                {/* Records Table */}
                <div className="crm-surface rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#f7f2ec] text-[#6e6357]">
                          <th className="px-3 py-3 text-left">
                            <input type="checkbox" checked={selectedRecords.size === selectedBatch.records.length && selectedBatch.records.length > 0}
                              onChange={toggleAll} className="rounded" />
                          </th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Name</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Phone</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Call ID</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Heat</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Caller</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Call Status</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBatch.records.length === 0 ? (
                          <tr><td colSpan={9} className="px-4 py-8 text-center text-[#8f8378]">No records match filters</td></tr>
                        ) : selectedBatch.records.map(r => (
                          <tr key={r.id} className={`border-t border-[#f0e8de] hover:bg-[#fdf9f4] transition-colors ${selectedRecords.has(r.id) ? 'bg-[#fdf5ef]' : ''}`}>
                            <td className="px-3 py-2.5">
                              <input type="checkbox" checked={selectedRecords.has(r.id)} onChange={() => toggleRecord(r.id)} />
                            </td>
                            <td className="px-3 py-2.5 font-medium text-[#2d261f]">{r.name || '—'}</td>
                            <td className="px-3 py-2.5 text-[#6e6357] font-mono text-xs">{r.phone_number || '—'}</td>
                            <td className="px-3 py-2.5 text-[#8f8378] text-xs truncate max-w-[120px]">{r.call_id || '—'}</td>
                            <td className="px-3 py-2.5"><HeatBadge heat={r.lead_heat_bucket} /></td>
                            <td className="px-3 py-2.5 text-[#6e6357] text-xs">{r.caller_name || '—'}</td>
                            <td className="px-3 py-2.5"><StatusBadge status={r.ingestion_status} /></td>
                            <td className="px-3 py-2.5 text-[#6e6357] text-xs">{r.call_status || '—'}</td>
                            <td className="px-3 py-2.5 text-[#6e6357] text-xs">{r.duration || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
