'use client'
// ─── TASKS PAGE ──────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/shared/Sidebar'
import { useAllTasks, useCompleteTask } from '@/hooks/useQueries'
import { useContacts, useProperties, useVisits } from '@/hooks/useQueries'
import { formatDateTime, formatDate, formatCurrency } from '@/lib/utils'
import { contactsApi, propertiesApi, visitsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export function TasksPageContent() {
  const router = useRouter()
  const [filter, setFilter] = useState<'pending' | 'overdue' | 'done'>('pending')
  const { data: tasks, isLoading } = useAllTasks({ status: filter })
  const { mutateAsync: complete } = useCompleteTask()

  const priorityColor: Record<string, string> = {
    high: 'text-red-700 bg-red-50 border-red-200',
    normal: 'text-[#61584f] bg-[#f7f2ec] border-[#e6dbcf]',
    low: 'text-[#2f6fa8] bg-[#eef5fb] border-[#d0e0f1]',
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 crm-page-enter">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight text-[#1f1914]">Tasks</h2>
            <p className="text-[#7a7065] font-medium tracking-wide text-sm mt-1.5">Follow-ups and action items across all leads</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-8 bg-[#faf5ee] border border-[#e8ddcf] p-1.5 rounded-full w-fit">
          {(['pending', 'overdue', 'done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-all capitalize ${filter === f ? 'bg-white text-[#2b241f] shadow-sm ring-1 ring-black/5' : 'text-[#8a7f74] hover:text-[#2b241f]'}`}>
              {f}
              {f === 'overdue' && <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">!</span>}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" /></div>
        ) : !tasks?.length ? (
          <div className="text-center py-20"><p className="text-gray-400">No {filter} tasks</p></div>
        ) : (
          <div className="crm-surface rounded-3xl overflow-hidden shadow-sm">
            {tasks.map((task, i) => (
              <div key={task.id} className={`flex items-center gap-4 px-6 py-4 ${i < tasks.length - 1 ? 'border-b border-[#eee5d9]' : ''} ${task.status === 'overdue' ? 'bg-red-50/20' : 'hover:bg-[#f9f4ee]'}`}>
                {task.status !== 'done' && (
                  <button onClick={() => complete(task.id).then(() => toast.success('Done!'))}
                    className="w-5 h-5 rounded border-2 border-gray-300 hover:border-emerald-500 flex-shrink-0 transition-colors" />
                )}
                {task.status === 'done' && <div className="w-5 h-5 rounded bg-emerald-100 border-2 border-emerald-400 flex-shrink-0 flex items-center justify-center text-emerald-600 text-xs">✓</div>}

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${task.status === 'overdue' ? 'text-red-700' : task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {task.title}
                  </p>
                  {task.due_at && <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(task.due_at)}</p>}
                </div>

                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${priorityColor[task.priority] ?? priorityColor.normal}`}>
                  {task.priority}
                </span>

                {task.lead_id && (
                  <button onClick={() => router.push(`/leads/${task.lead_id}`)}
                    className="text-xs text-[#a65630] hover:underline flex-shrink-0">
                    View lead →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── CONTACTS PAGE ───────────────────────────────────────────────────────────
export function ContactsPageContent() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const { data: contacts, isLoading } = useContacts(search)

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 crm-page-enter">
        <div className="flex items-center justify-between mb-8 px-2">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight text-[#1f1914]">Contacts</h2>
            <p className="text-[#7a7065] font-medium tracking-wide text-sm mt-1.5">{contacts?.length ?? 0} connections</p>
          </div>
        </div>
        <div className="mb-6 px-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="px-5 py-3 bg-[#fffdfa] border border-[#e7dccf] rounded-full text-[14px] outline-none focus:ring-2 focus:ring-[#c86f43]/30 shadow-sm w-96 transition-shadow" />
        </div>
        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" /></div>
        ) : (
          <div className="crm-surface rounded-3xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#eee5d9] bg-[#faf4ec]/50">
                  {['Name', 'Phone', 'Email', 'Type', 'Source', 'Added'].map(h => (
                    <th key={h} className="text-left text-[11px] uppercase tracking-widest font-semibold text-gray-400 px-6 py-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts?.map(c => (
                  <tr key={c.id} className="border-b border-[#f0e7dc] hover:bg-[#faf5ee] cursor-pointer transition-colors"
                    onClick={() => router.push(`/contacts/${c.id}`)}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3.5">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-gray-100 to-gray-50 shadow-inner border border-gray-200/60 text-[#1d1d1f] font-semibold text-[13px] flex items-center justify-center flex-shrink-0">
                          {c.name.charAt(0)}
                        </div>
                        <span className="text-[14px] font-semibold tracking-tight text-[#1d1d1f]">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.phone}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.email ?? '—'}</td>
                    <td className="px-4 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{c.type}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{c.source ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!contacts?.length && <p className="text-center text-gray-400 py-12">No contacts found</p>}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── PROPERTIES PAGE ─────────────────────────────────────────────────────────
export function PropertiesPageContent() {
  const [showAdd, setShowAdd] = useState(false)
  const qc = useQueryClient()
  const { data: properties, isLoading } = useProperties()

  const statusColor: Record<string, string> = {
    available: 'bg-emerald-100 text-emerald-700',
    sold: 'bg-gray-100 text-gray-500',
    rented: 'bg-blue-100 text-blue-700',
    under_negotiation: 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 crm-page-enter">
        <div className="flex items-center justify-between mb-8 px-2">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight text-[#1f1914]">Properties</h2>
            <p className="text-[#7a7065] font-medium tracking-wide text-sm mt-1.5">{properties?.length ?? 0} listings in inventory</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="px-6 py-3 bg-[#be6a3f] text-white rounded-full text-sm font-semibold hover:bg-[#a95d36] shadow-sm transition-all">
            + Add listing
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {properties?.map(p => (
              <div key={p.id} className="crm-surface crm-card-hover rounded-2xl p-5 cursor-pointer">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="font-semibold text-gray-900 text-sm leading-snug">{p.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {p.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-3">{p.locality}, {p.city}</p>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-[#a65630]">{formatCurrency(p.price)}</span>
                  <div className="flex gap-2 text-xs text-gray-400">
                    {p.bedrooms && <span>{p.bedrooms} BHK</span>}
                    {p.area_sqft && <span>{p.area_sqft.toLocaleString()} sqft</span>}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{p.type}</span>
                  <span className="text-xs text-gray-400 capitalize">{p.transaction_type}</span>
                </div>
              </div>
            ))}
            {!properties?.length && <p className="text-gray-400 col-span-3 text-center py-12">No properties yet. Add your first listing.</p>}
          </div>
        )}

        {showAdd && <AddPropertyModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['properties'] }) }} />}
      </main>
    </div>
  )
}

function AddPropertyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', type: 'apartment', status: 'available', transaction_type: 'sale', price: '', bedrooms: '', bathrooms: '', locality: '', city: '', area_sqft: '' })
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!form.title) return toast.error('Title is required')
    setLoading(true)
    try {
      await propertiesApi.create({ ...form, price: form.price ? Number(form.price) : null, bedrooms: form.bedrooms ? Number(form.bedrooms) : null, bathrooms: form.bathrooms ? Number(form.bathrooms) : null, area_sqft: form.area_sqft ? Number(form.area_sqft) : null })
      toast.success('Property added!')
      onCreated()
    } catch { toast.error('Failed to add property') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900">Add new property</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="space-y-3">
          {[['Title *', 'title'], ['City', 'city'], ['Locality', 'locality']].map(([label, key]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none bg-white">
                {['apartment', 'villa', 'plot', 'commercial', 'office'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Transaction</label>
              <select value={form.transaction_type} onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none bg-white">
                {['sale', 'rent', 'lease'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['Price (₹)', 'price'], ['Bedrooms', 'bedrooms'], ['Area (sqft)', 'area_sqft']].map(([label, key]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input type="number" value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3 border border-gray-200/80 rounded-full text-sm font-semibold text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-50 transition-all">Cancel</button>
          <button onClick={submit} disabled={loading} className="flex-1 py-3 bg-[#1d1d1f] text-white rounded-full text-sm font-semibold disabled:opacity-50 hover:bg-black transition-all shadow-sm">
            {loading ? 'Adding...' : 'Add property'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── VISITS PAGE ─────────────────────────────────────────────────────────────
export function VisitsPageContent() {
  const { data: visits, isLoading } = useVisits()
  const qc = useQueryClient()
  const statusColor: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    done: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-gray-100 text-gray-500',
    no_show: 'bg-red-100 text-red-700',
  }

  const updateVisitStatus = async (visitId: string, status: string) => {
    try {
      await visitsApi.update(visitId, { status })
      toast.success(`Visit marked as ${status.replace('_', ' ')}`)
      qc.invalidateQueries({ queryKey: ['visits'] })
    } catch {
      toast.error('Failed to update visit status')
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 crm-page-enter">
        <div className="mb-6">
          <h2 className="text-4xl font-semibold text-[#1f1914]">Site Visits</h2>
          <p className="text-[#7a7065] mt-1">Scheduled and completed property visits</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full" /></div>
        ) : !visits?.length ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No site visits scheduled yet</p>
            <p className="text-xs text-gray-300 mt-1">Schedule visits from the lead detail page</p>
          </div>
        ) : (
          <div className="crm-surface rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#eee5d9]">
                  {['Date & Time', 'Lead', 'Agent', 'Status', 'Confirmed', 'Action'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visits.map(v => (
                  <tr key={v.id} className="border-b border-[#f1e8dd] hover:bg-[#faf5ee]">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatDateTime(v.scheduled_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <p className="font-medium text-indigo-600">{v.lead_contact_name ?? `Lead ${v.lead_id.slice(0, 8)}…`}</p>
                      {v.lead_contact_phone && <p className="text-xs text-gray-500">{v.lead_contact_phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{v.agent_name ?? 'Unassigned'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[v.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {v.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{v.client_confirmed ? '✅ Yes' : '⏳ Pending'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={v.status}
                        onChange={(e) => updateVisitStatus(v.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                      >
                        <option value="scheduled">scheduled</option>
                        <option value="done">done</option>
                        <option value="cancelled">cancelled</option>
                        <option value="no_show">no show</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
