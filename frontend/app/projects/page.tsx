'use client'

import { useMemo, useState } from 'react'
import Sidebar from '@/components/shared/Sidebar'
import { ScoreBadge } from '@/components/shared/Badges'
import { useLeads, useProjectDetail, useProjectsModule } from '@/hooks/useQueries'
import { projectsApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export default function ProjectsPage() {
  const qc = useQueryClient()
  const { data: projects = [], isLoading } = useProjectsModule()
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const { data: detail, refetch } = useProjectDetail(selectedProjectId)
  const { data: allLeads = [] } = useLeads()

  const [showCreate, setShowCreate] = useState(false)
  const [showTagPanel, setShowTagPanel] = useState(false)

  const [form, setForm] = useState({
    name: '',
    developer: '',
    location: '',
    city: '',
    bhk_options_csv: '',
    price_range_min: '',
    price_range_max: '',
    brochure_url: '',
    status: 'active',
  })

  const usedLeadIds = useMemo(() => new Set((detail?.leads ?? []).map(l => l.id)), [detail])

  const createProject = async () => {
    if (!form.name.trim()) return toast.error('Project name is required')
    try {
      const payload = {
        ...form,
        price_range_min: form.price_range_min ? Number(form.price_range_min) : null,
        price_range_max: form.price_range_max ? Number(form.price_range_max) : null,
      }
      const created = await projectsApi.create(payload)
      toast.success('Project created')
      setShowCreate(false)
      setForm({ name: '', developer: '', location: '', city: '', bhk_options_csv: '', price_range_min: '', price_range_max: '', brochure_url: '', status: 'active' })
      await qc.invalidateQueries({ queryKey: ['projects-module'] })
      setSelectedProjectId(created.id)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to create project')
    }
  }

  const updateProject = async () => {
    if (!detail?.project) return
    try {
      const payload = {
        ...form,
        price_range_min: form.price_range_min ? Number(form.price_range_min) : null,
        price_range_max: form.price_range_max ? Number(form.price_range_max) : null,
      }
      await projectsApi.update(detail.project.id, payload)
      toast.success('Project updated')
      await qc.invalidateQueries({ queryKey: ['projects-module'] })
      await refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to update project')
    }
  }

  const addTag = async (leadId: string) => {
    if (!selectedProjectId) return
    try {
      await projectsApi.addLeadTag(selectedProjectId, leadId)
      toast.success('Project tag added')
      await refetch()
      await qc.invalidateQueries({ queryKey: ['leads'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to add tag')
    }
  }

  const removeTag = async (leadId: string) => {
    if (!selectedProjectId) return
    try {
      await projectsApi.removeLeadTag(selectedProjectId, leadId)
      toast.success('Project tag removed')
      await refetch()
      await qc.invalidateQueries({ queryKey: ['leads'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to remove tag')
    }
  }

  const loadProjectIntoForm = () => {
    if (!detail?.project) return
    setForm({
      name: detail.project.name || '',
      developer: detail.project.developer || '',
      location: detail.project.location || '',
      city: detail.project.city || '',
      bhk_options_csv: (detail.project.bhk_options || []).join(', '),
      price_range_min: detail.project.price_range_min?.toString() || '',
      price_range_max: detail.project.price_range_max?.toString() || '',
      brochure_url: detail.project.brochure_url || '',
      status: detail.project.status || 'active',
    })
  }

  return (
    <div className="flex min-h-screen bg-[#f7f5f2]">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight text-[#1f1914]">Projects</h2>
            <p className="text-[#7a7065] text-sm mt-1">Classify and manage leads by project</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 rounded-full bg-[#2a231d] text-white text-sm font-semibold">+ New Project</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <section className="bg-white border border-[#eadfce] rounded-2xl p-4 h-fit">
            <h3 className="text-sm font-semibold text-[#2a231d] mb-3">Project List</h3>
            {isLoading ? <p className="text-sm text-[#7a7065]">Loading...</p> : (
              <div className="space-y-2">
                {projects.map(project => (
                  <button
                    key={project.id}
                    onClick={() => {
                      setSelectedProjectId(project.id)
                      setTimeout(loadProjectIntoForm, 50)
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border ${selectedProjectId === project.id ? 'bg-[#f7ede4] border-[#e0c4aa]' : 'bg-white border-[#eee2d2]'}`}
                  >
                    <p className="text-sm font-semibold text-[#2a231d]">{project.name}</p>
                    <p className="text-xs text-[#8a7d70]">{project.city || '—'} · {project.status}</p>
                  </button>
                ))}
                {!projects.length && <p className="text-sm text-[#8a7d70]">No projects yet</p>}
              </div>
            )}
          </section>

          <section className="space-y-5">
            {!selectedProjectId || !detail ? (
              <div className="bg-white border border-[#eadfce] rounded-2xl p-6 text-[#8a7d70]">Select a project to view leads and settings.</div>
            ) : (
              <>
                <div className="bg-white border border-[#eadfce] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-[#2a231d]">{detail.project.name}</h3>
                    <button onClick={loadProjectIntoForm} className="text-sm text-[#a65630] hover:underline">Load for edit</button>
                  </div>
                  <p className="text-xs text-[#8a7d70]">Created: {formatDate(detail.project.created_at)}</p>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                    <Stat label="Total" value={detail.leads.length} />
                    <Stat label="Hot" value={detail.leads.filter(l => l.lead_score === 'hot').length} tone="text-red-600" />
                    <Stat label="Warm" value={detail.leads.filter(l => l.lead_score === 'warm').length} tone="text-amber-600" />
                    <Stat label="Cold" value={detail.leads.filter(l => l.lead_score === 'cold').length} tone="text-slate-600" />
                  </div>
                </div>

                <div className="bg-white border border-[#eadfce] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-[#2a231d]">Edit Project Details</h4>
                    <button onClick={updateProject} className="px-4 py-2 rounded-full bg-[#2a231d] text-white text-sm">Save</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input label="Name" value={form.name} onChange={(v) => setForm(f => ({ ...f, name: v }))} />
                    <Input label="Developer" value={form.developer} onChange={(v) => setForm(f => ({ ...f, developer: v }))} />
                    <Input label="Location" value={form.location} onChange={(v) => setForm(f => ({ ...f, location: v }))} />
                    <Input label="City" value={form.city} onChange={(v) => setForm(f => ({ ...f, city: v }))} />
                    <Input label="BHK options (comma-separated)" value={form.bhk_options_csv} onChange={(v) => setForm(f => ({ ...f, bhk_options_csv: v }))} />
                    <Input label="Brochure URL" value={form.brochure_url} onChange={(v) => setForm(f => ({ ...f, brochure_url: v }))} />
                    <Input label="Price Min" value={form.price_range_min} onChange={(v) => setForm(f => ({ ...f, price_range_min: v }))} type="number" />
                    <Input label="Price Max" value={form.price_range_max} onChange={(v) => setForm(f => ({ ...f, price_range_max: v }))} type="number" />
                  </div>
                </div>

                <div className="bg-white border border-[#eadfce] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-[#2a231d]">Project Leads</h4>
                    <button onClick={() => setShowTagPanel(s => !s)} className="text-sm text-[#a65630] hover:underline">
                      {showTagPanel ? 'Hide Tag Manager' : 'Add/Remove Project Tag'}
                    </button>
                  </div>

                  <div className="overflow-auto border border-[#f0e5d7] rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="bg-[#fcf7f0]"><tr><th className="px-3 py-2 text-left">Lead</th><th className="px-3 py-2 text-left">Score</th><th className="px-3 py-2 text-left">Stage</th><th className="px-3 py-2 text-left">Tag</th></tr></thead>
                      <tbody>
                        {detail.leads.map(lead => (
                          <tr key={lead.id} className="border-t border-[#f3ece2]">
                            <td className="px-3 py-2">
                              <p className="font-medium text-[#2a231d]">{lead.contact?.name || '—'}</p>
                              <p className="text-xs text-[#8a7d70]">{lead.contact?.phone || '—'}</p>
                            </td>
                            <td className="px-3 py-2"><ScoreBadge score={lead.lead_score} /></td>
                            <td className="px-3 py-2">{lead.stage}</td>
                            <td className="px-3 py-2"><button onClick={() => removeTag(lead.id)} className="text-xs text-red-600 hover:underline">Remove tag</button></td>
                          </tr>
                        ))}
                        {!detail.leads.length && <tr><td className="px-3 py-4 text-[#8a7d70]" colSpan={4}>No leads tagged to this project</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {showTagPanel && (
                    <div className="mt-4 border border-[#f0e5d7] rounded-xl p-3">
                      <p className="text-xs font-semibold text-[#5f5348] mb-2">Available Leads</p>
                      <div className="max-h-64 overflow-auto space-y-1">
                        {allLeads.filter(lead => !usedLeadIds.has(lead.id)).map(lead => (
                          <div key={lead.id} className="flex items-center justify-between text-sm border-b border-[#f6f0e7] py-1.5">
                            <span>{lead.contact?.name || lead.id.slice(0, 8)} · {lead.lead_score}</span>
                            <button onClick={() => addTag(lead.id)} className="text-[#a65630] hover:underline text-xs">Add tag</button>
                          </div>
                        ))}
                        {!allLeads.filter(lead => !usedLeadIds.has(lead.id)).length && <p className="text-xs text-[#8a7d70]">No untagged leads available.</p>}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-5 w-full max-w-lg">
              <h3 className="text-lg font-semibold text-[#2a231d] mb-3">Create Project</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label="Name" value={form.name} onChange={(v) => setForm(f => ({ ...f, name: v }))} />
                <Input label="Developer" value={form.developer} onChange={(v) => setForm(f => ({ ...f, developer: v }))} />
                <Input label="Location" value={form.location} onChange={(v) => setForm(f => ({ ...f, location: v }))} />
                <Input label="City" value={form.city} onChange={(v) => setForm(f => ({ ...f, city: v }))} />
                <Input label="BHK options" value={form.bhk_options_csv} onChange={(v) => setForm(f => ({ ...f, bhk_options_csv: v }))} />
                <Input label="Brochure URL" value={form.brochure_url} onChange={(v) => setForm(f => ({ ...f, brochure_url: v }))} />
              </div>
              <div className="flex gap-2 mt-4 justify-end">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-full text-sm">Cancel</button>
                <button onClick={createProject} className="px-4 py-2 rounded-full bg-[#2a231d] text-white text-sm">Create</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-xs text-[#7f7266] font-medium">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full px-3 py-2 border border-[#e4d7c5] rounded-xl" />
    </div>
  )
}

function Stat({ label, value, tone = 'text-[#2a231d]' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border border-[#eadfce] rounded-xl p-3 bg-[#fffdfb]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#8c7f73] font-semibold">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${tone}`}>{value}</p>
    </div>
  )
}
