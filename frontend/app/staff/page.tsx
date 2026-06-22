'use client'
import { useEffect, useState } from 'react'
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
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'call_agent' })

  const isAdmin = agent?.role === 'admin'

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
    setDistributing(true)
    try {
      const r = await leadsApi.distribute({ only_unassigned: true })
      const lines = r.breakdown.filter(b => b.assigned > 0).map(b => `${b.agent_name}: ${b.assigned}`).join(' · ')
      toast.success(r.assigned ? `Assigned ${r.assigned} leads — ${lines}` : 'No unassigned leads to distribute', { duration: 6000 })
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      const status = e?.response?.status
      toast.error(detail ?? (status ? `Distribution failed (HTTP ${status})` : e?.message ?? 'Distribution failed — network/timeout'))
    } finally {
      setDistributing(false)
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
            <button onClick={distribute} disabled={distributing}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {distributing ? 'Distributing…' : '🔀 Distribute unassigned leads'}
            </button>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
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
