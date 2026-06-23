'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import Sidebar from '@/components/shared/Sidebar'
import { authApi, leadsApi } from '@/lib/api'
import toast from 'react-hot-toast'
import type { Agent } from '@/lib/types'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin (full access)',
  manager: 'Manager',
  agent: 'Agent',
  call_agent: 'Call Agent',
}

export default function StaffPage() {
  const { agent } = useAuthStore()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [distributing, setDistributing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // The leads from the most recently uploaded sheet — assignment is scoped to these.
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [batchName, setBatchName] = useState('')
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'call_agent' })
  const fileRef = useRef<HTMLInputElement>(null)

  const isAdmin = agent?.role === 'admin'
  const callAgents = agents.filter(a => a.role === 'call_agent' || a.role === 'agent')

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const load = async () => {
    setLoading(true)
    try {
      setAgents(await authApi.listAgents())
    } catch {
      toast.error('Could not load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createAgent = async (data: { name: string; email: string; password: string; role: string }) => {
    try {
      await authApi.createAgent(data)
      toast.success(`Created ${data.email}`)
      await load()
      return true
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? `Failed to create ${data.email}`)
      return false
    }
  }

  const submitForm = async () => {
    if (!form.name || !form.email || !form.password) return toast.error('Name, email and password are required')
    setCreating(true)
    const ok = await createAgent(form)
    if (ok) setForm({ name: '', email: '', password: '', role: 'call_agent' })
    setCreating(false)
  }

  const distribute = async () => {
    if (selectedIds.size === 0) return toast.error('Select at least one agent to assign leads to')
    if (batchIds.length === 0) return toast.error('Upload an Excel/CSV sheet first — only the uploaded leads are assigned')
    setDistributing(true)
    try {
      const r = await leadsApi.distribute({ selected_agent_ids: Array.from(selectedIds), lead_ids: batchIds })
      const lines = r.breakdown.filter(b => b.assigned > 0).map(b => `${b.agent_name}: ${b.assigned}`).join(' · ')
      toast.success(r.assigned ? `Assigned ${r.assigned} uploaded leads — ${lines}` : 'Nothing to assign', { duration: 6000 })
      // Batch consumed — clear it so we don't re-assign the same sheet.
      setBatchIds([])
      setBatchName('')
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      const status = e?.response?.status
      toast.error(detail ?? (status ? `Assignment failed (HTTP ${status})` : e?.message ?? 'Assignment failed — network/timeout'))
    } finally {
      setDistributing(false)
    }
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const r = await leadsApi.uploadLeads(file)
      setBatchIds(r.lead_ids ?? [])
      setBatchName(file.name)
      toast.success(`Uploaded ${r.created} lead(s) from ${file.name}${r.skipped ? ` · ${r.skipped} skipped (missing/invalid phone)` : ''}. Now pick agents and assign.`, { duration: 7000 })
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const deleteUploaded = async () => {
    if (!confirm('Delete ALL leads imported via Staff uploads (and their contacts)? This cannot be undone.')) return
    setDeleting(true)
    try {
      const r = await leadsApi.deleteUploadedLeads()
      toast.success(`Deleted ${r.deleted_leads} uploaded lead(s)`, { duration: 6000 })
      setBatchIds([])
      setBatchName('')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const toggleActive = async (a: Agent) => {
    // Only deactivation is supported by the API (soft delete).
    if (!a.is_active) return toast('Re-activation isn\'t supported yet — create a new account.')
    if (a.id === agent?.id) return toast.error('You cannot deactivate yourself')
    if (!confirm(`Deactivate ${a.name}? They will no longer be able to log in.`)) return
    try {
      await authApi.deleteAgent(a.id)
      toast.success(`${a.name} deactivated`)
      await load()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to deactivate')
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">Only admins can manage staff &amp; agents.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Staff &amp; Agents</h2>
            <p className="text-sm text-gray-500 mt-0.5">Create call agents and distribute leads</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/staff/leaderboard')}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">
              📊 Leaderboard
            </button>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Assign leads: upload + pick agents + distribute */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Assign uploaded leads to call agents</h3>
            <p className="text-xs text-gray-500 mb-4">Upload an Excel/CSV sheet, choose the agents, then assign. <span className="font-medium text-gray-700">Only the leads from the uploaded sheet are assigned</span> — never your whole database.</p>

            {/* Step 1: upload */}
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-4 mb-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-gray-800">1 · Upload leads</p>
                  <p className="text-xs text-gray-500 mt-0.5">Excel/CSV with columns: <span className="font-medium">Name</span>, <span className="font-medium">Phone</span>, <span className="font-medium">Type</span> (Hot / Warm / Cold)</p>
                </div>
                <div className="flex items-center gap-2">
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f) }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
                    {uploading ? 'Uploading…' : '📄 Upload Excel / CSV'}
                  </button>
                </div>
              </div>
              {batchIds.length > 0 && (
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  ✓ {batchIds.length} lead(s) ready from <span className="font-semibold">{batchName}</span> — these are the only leads that will be assigned.
                </div>
              )}
            </div>

            {/* Step 2: pick agents */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-800">2 · Choose agents</p>
                <button onClick={() => setSelectedIds(new Set(callAgents.filter(a => a.is_active).map(a => a.id)))}
                  className="text-xs text-indigo-600 hover:underline">Select all</button>
              </div>
              {callAgents.length === 0 ? (
                <p className="text-xs text-gray-400">No call agents yet — add one below.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {callAgents.filter(a => a.is_active).map(a => {
                    const on = selectedIds.has(a.id)
                    return (
                      <button key={a.id} onClick={() => toggleSelect(a.id)}
                        className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {on ? '✓ ' : ''}{a.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Step 3: assign */}
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={distribute} disabled={distributing || selectedIds.size === 0 || batchIds.length === 0}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {distributing ? 'Assigning…' : `🔀 Assign ${batchIds.length || ''} uploaded lead${batchIds.length === 1 ? '' : 's'} to ${selectedIds.size || 'selected'} agent${selectedIds.size === 1 ? '' : 's'}`}
              </button>
              <button onClick={deleteUploaded} disabled={deleting}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                {deleting ? 'Deleting…' : '🗑 Remove uploaded leads from database'}
              </button>
            </div>
          </div>

          {/* Add agent */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-semibold text-gray-900">Add a new agent</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Name" className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@propello.ai" className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Password" className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="call_agent">Call Agent</option>
                <option value="agent">Agent</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={submitForm} disabled={creating}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
                {creating ? 'Adding…' : '+ Add agent'}
              </button>
            </div>
          </div>

          {/* Agent list */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
              <h3 className="font-semibold text-gray-900 text-sm">All agents ({agents.length})</h3>
            </div>
            {loading ? (
              <div className="py-12 text-center text-gray-400">Loading…</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/40">
                    {['Name', 'Email', 'Role', 'Status', ''].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900">{a.name}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{a.email}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.role === 'admin' ? 'bg-purple-100 text-purple-700' : a.role === 'call_agent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {ROLE_LABEL[a.role] ?? a.role}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {a.is_active ? '● Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {a.is_active && a.id !== agent?.id && (
                          <button onClick={() => toggleActive(a)}
                            className="text-xs text-red-500 hover:text-red-700 border border-red-100 px-2.5 py-1 rounded-lg hover:border-red-200">
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
