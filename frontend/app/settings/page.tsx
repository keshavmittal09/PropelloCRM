'use client'
import { useState, useEffect } from 'react'
import Sidebar from '@/components/shared/Sidebar'
import { useAuthStore } from '@/store/useAuthStore'
import { authApi } from '@/lib/api'
import toast from 'react-hot-toast'
import { Agent } from '@/lib/types'

export default function SettingsPage() {
  const { agent } = useAuthStore()
  const canViewTeam = ['admin', 'manager'].includes(agent?.role || '')
  const canManageTeam = agent?.role === 'admin'
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchAgents = async () => {
    try {
      const data = await authApi.listAgents()
      setAgents(data)
    } catch {
      toast.error('Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canViewTeam) fetchAgents()
    else setLoading(false)
  }, [agent, canViewTeam])

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this team member? This action cannot be undone.')) return
    setDeletingId(id)
    try {
      await authApi.deleteAgent(id)
      toast.success('Team member removed')
      fetchAgents()
    } catch {
      toast.error('Failed to remove team member')
    } finally {
      setDeletingId(null)
    }
  }

  if (!canViewTeam) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 p-8 flex items-center justify-center">
          <p className="text-gray-500">You do not have permission to view this page.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-8 px-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-[#1d1d1f]">Settings</h2>
            <p className="text-[#86868b] font-medium tracking-wide text-sm mt-1.5">Manage team members and CRM parameters</p>
          </div>
        </div>

        <section className="bg-white/80 backdrop-blur-xl border border-gray-100/80 rounded-3xl p-6 shadow-sm mb-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-[17px] tracking-tight font-semibold text-[#1d1d1f]">Team Management</h3>
            {canManageTeam && (
              <button onClick={() => setShowAdd(true)}
                className="px-6 py-2.5 bg-[#1d1d1f] text-white rounded-full text-sm font-semibold hover:bg-black transition-all shadow-sm">
                + Add Member
              </button>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-gray-500 text-center py-4">Loading team...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100/60 text-left text-[11px] uppercase tracking-widest font-semibold text-gray-400">
                    <th className="pb-4 pr-4">Name</th>
                    <th className="pb-4 px-4">Email</th>
                    <th className="pb-4 px-4">Phone</th>
                    <th className="pb-4 px-4">Role</th>
                    <th className="pb-4 px-4">Status</th>
                    <th className="pb-4 px-4">Joined</th>
                    <th className="pb-4 pl-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.id} className="border-b border-gray-100/50 hover:bg-[#fbfbfd]">
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-200 to-gray-100 flex items-center justify-center text-[#1d1d1f] font-semibold text-[13px] shadow-inner border border-gray-200/50">
                            {a.name.charAt(0)}
                          </div>
                          <span className="text-[14px] font-semibold tracking-tight text-[#1d1d1f]">{a.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{a.email}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{a.phone ?? '—'}</td>
                      <td className="py-3 px-4 text-sm capitalize">{a.role}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {a.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">{new Date(a.created_at).toLocaleDateString()}</td>
                      <td className="py-3 pl-4">
                        {canManageTeam ? (
                          <button
                            onClick={() => handleDelete(a.id)}
                            disabled={deletingId === a.id || a.id === agent?.id}
                            className="text-xs text-red-600 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {deletingId === a.id ? 'Removing...' : a.id === agent?.id ? 'Current user' : 'Remove'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        
        {canManageTeam && showAdd && <AddAgentModal onClose={() => setShowAdd(false)} onAdded={fetchAgents} />}
      </main>
    </div>
  )
}

function AddAgentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent', phone: '' })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.name || !form.email || !form.password) return toast.error('Required fields missing')
    setSaving(true)
    try {
      await authApi.createAgent(form)
      toast.success('Agent created successfully')
      onAdded()
      onClose()
    } catch {
      toast.error('Failed to create agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="font-semibold tracking-tight text-[18px] text-[#1d1d1f] mb-6">Add New Team Member</h3>
        <div className="space-y-4">
          <input placeholder="Full Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-4 py-3 border border-gray-200/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1d1d1f]/10 transition-all bg-[#fbfbfd]" />
          <input placeholder="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full px-4 py-3 border border-gray-200/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1d1d1f]/10 transition-all bg-[#fbfbfd]" />
          <input placeholder="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full px-4 py-3 border border-gray-200/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1d1d1f]/10 transition-all bg-[#fbfbfd]" />
          <input placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full px-4 py-3 border border-gray-200/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#1d1d1f]/10 transition-all bg-[#fbfbfd]" />
          <div>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="w-full px-4 py-3 border border-gray-200/80 rounded-xl text-sm outline-none bg-[#fbfbfd]">
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 border border-gray-200/80 rounded-full text-sm font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-50 transition-all">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 py-3 bg-[#1d1d1f] text-white rounded-full text-sm font-semibold hover:bg-black transition-all shadow-sm disabled:opacity-50">
            {saving ? 'Adding...' : 'Add Member'}
          </button>
        </div>
      </div>
    </div>
  )
}
