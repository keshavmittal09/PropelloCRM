'use client'
import { useEffect, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { campaignDashboardApi, campaignsApi, leadsApi, authApi } from '@/lib/api'
import type { AssignmentTableLead, Agent } from '@/lib/types'
import toast from 'react-hot-toast'

const PRIORITY_OPTIONS_FULL = ['P1', 'P2', 'P3', 'P4', 'P5', 'high', 'normal', 'low']

interface Props {
  batchId?: string  // For campaign dashboard hub (batch-based)
  campaignId?: string  // For campaign detail dashboard (campaign-based)
}

const PRIORITY_OPTIONS = ['', 'P1', 'P2', 'P3', 'P4', 'P5']
const ASSIGNED_OPTIONS = ['', 'assigned', 'unassigned']

const TIER_COLORS: Record<string, string> = {
  P1: 'bg-red-100 text-red-800 border-red-200',
  P2: 'bg-orange-100 text-orange-800 border-orange-200',
  P3: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  P4: 'bg-blue-100 text-blue-800 border-blue-200',
  P5: 'bg-gray-100 text-gray-700 border-gray-200',
}

export function LeadAssignmentTab({ batchId, campaignId }: Props) {
  const qc = useQueryClient()
  const isBatchMode = !!batchId && !campaignId
  const isCampaignMode = !!campaignId && !batchId
  const effectiveId = batchId || campaignId || ''
  const canEditPriority = isCampaignMode

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [targetAgentId, setTargetAgentId] = useState('')
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [reassignmentReason, setReassignmentReason] = useState('')
  const [showReassignmentWarning, setShowReassignmentWarning] = useState(false)
  const [updatingPriorityId, setUpdatingPriorityId] = useState<string | null>(null)

  const params = useMemo(() => ({
    page,
    limit: 50,
    ...(priorityFilter ? { priority_tier: priorityFilter } : {}),
    ...(assignedFilter ? { assigned: assignedFilter } : {}),
    ...(agentFilter ? { agent_name: agentFilter } : {}),
    ...(search ? { search } : {}),
    ...(sortBy ? { sort_by: sortBy, sort_dir: sortDir } : {}),
  }), [page, priorityFilter, assignedFilter, agentFilter, search, sortBy, sortDir])

  const { data, isLoading, error } = useQuery({
    queryKey: ['assignment-table', effectiveId, params, isBatchMode],
    queryFn: () => isBatchMode
      ? campaignDashboardApi.assignmentTable(effectiveId, params)
      : leadsApi.getCampaignAssignmentTable(effectiveId, params),
    enabled: !!effectiveId,
  })

  const { data: agents } = useQuery({
    queryKey: ['agents-list'],
    queryFn: authApi.listAgents,
  })

  // Log errors for debugging
  useEffect(() => {
    if (error) {
      console.error('Assignment table error:', error)
    }
  }, [error])

  const leads = data?.leads ?? []
  const totalPages = data?.total_pages ?? 0
  const totalLeads = data?.total ?? 0

  const allSelected = leads.length > 0 && leads.every(l => selected.has(l.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(leads.map(l => l.id)))
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const checkReassignments = () => {
    const leadsToAssign = leads.filter(l => selected.has(l.id))
    const alreadyAssigned = leadsToAssign.filter(l => l.assigned_agent && l.assigned_agent !== agents?.find((a: Agent) => a.id === targetAgentId)?.name)
    return alreadyAssigned.length
  }

  const handleAssign = async () => {
    const reassignCount = checkReassignments()
    if (reassignCount > 0) {
      setShowReassignmentWarning(true)
      return
    }
    await performAssign()
  }

  const performAssign = async (reason?: string) => {
    if (!targetAgentId || selected.size === 0) return
    setAssigning(true)
    try {
      const payload = {
        lead_ids: Array.from(selected),
        agent_id: targetAgentId,
        reason: reason || undefined,
      }
      const result = isBatchMode
        ? await campaignDashboardApi.bulkAssign(effectiveId, payload)
        : await leadsApi.bulkAssignCampaignLeads(effectiveId, payload)
      const agentName = agents?.find((a: Agent) => a.id === targetAgentId)?.name ?? 'Agent'
      toast.success(`${result.assigned} leads assigned to ${agentName}`)
      if (result.reassigned > 0) {
        toast(`${result.reassigned} leads were reassigned from other agents`, { icon: '⚠️' })
      }
      setSelected(new Set())
      setShowAssignModal(false)
      setShowReassignmentWarning(false)
      setTargetAgentId('')
      setReassignmentReason('')
      qc.invalidateQueries({ queryKey: ['assignment-table'] })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to assign leads'
      toast.error(msg)
    } finally {
      setAssigning(false)
    }
  }

  const handleAutoAssign = async () => {
    if (!confirm('Auto-assign all unassigned leads? P1/P2 will go to top-rated agents, others will be load-balanced.')) return
    setAutoAssigning(true)
    try {
      let result
      if (isBatchMode) {
        // Batch mode (campaign dashboard hub)
        result = await campaignDashboardApi.autoAssign(effectiveId)
      } else {
        // Campaign mode (campaign detail dashboard)
        result = await campaignsApi.executeAgentAssignment(effectiveId)
      }
      toast.success(`${result.assigned || 0} leads auto-assigned`)
      qc.invalidateQueries({ queryKey: ['assignment-table'] })
    } catch (e: any) {
      console.error('Auto-assign error:', e)
      toast.error(e?.response?.data?.detail || 'Failed to auto-assign leads')
    } finally {
      setAutoAssigning(false)
    }
  }

  const handlePriorityChange = async (leadId: string, newPriority: string) => {
    if (!canEditPriority) {
      toast.error('Priority override is only available for CRM campaign leads')
      return
    }
    setUpdatingPriorityId(leadId)
    try {
      await leadsApi.updateLeadPriority(leadId, newPriority)
      toast.success(`Priority updated to ${newPriority}`)
      qc.invalidateQueries({ queryKey: ['assignment-table'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to update priority')
    } finally {
      setUpdatingPriorityId(null)
    }
  }

  // Count leads per agent for the assignment dropdown
  const agentLeadCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    leads.forEach(l => {
      if (l.assigned_agent) {
        counts[l.assigned_agent] = (counts[l.assigned_agent] || 0) + 1
      }
    })
    return counts
  }, [leads])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name or phone..."
            className="w-full pl-9 pr-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c86f43] focus:ring-1 focus:ring-[#c86f43]/20"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#96897c]">🔍</span>
        </div>

        {/* Filters */}
        <select
          value={priorityFilter}
          onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}
          className="px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c86f43]"
        >
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.filter(Boolean).map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <select
          value={assignedFilter}
          onChange={e => { setAssignedFilter(e.target.value); setPage(1) }}
          className="px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c86f43]"
        >
          <option value="">All assignment</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Unassigned</option>
        </select>

        <input
          value={agentFilter}
          onChange={e => { setAgentFilter(e.target.value); setPage(1) }}
          placeholder="Filter by agent..."
          className="px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c86f43] w-40"
        />

        {/* Auto-assign button */}
        <button
          onClick={handleAutoAssign}
          disabled={autoAssigning}
          className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {autoAssigning ? 'Auto-Assigning...' : '⚡ Auto-Assign'}
        </button>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#c86f43]/10 to-orange-50 border border-[#c86f43]/20 rounded-xl">
          <span className="text-sm font-semibold text-[#c86f43]">
            {selected.size} lead{selected.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setShowAssignModal(true)}
            className="px-5 py-2 bg-[#c86f43] text-white rounded-xl text-sm font-semibold hover:bg-[#a65630] transition-colors shadow-sm"
          >
            Assign Selected
          </button>
        </div>
      )}

      {/* Table */}
      <div className="crm-surface rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#faf7f3] border-b border-[#e8ddcf]">
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-[#e1d3c2] text-[#c86f43] focus:ring-[#c86f43]/30"
                  />
                </th>
                <SortableHeader label="Lead Name" field="name" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <SortableHeader label="Phone" field="phone" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <SortableHeader label="Priority" field="priority_tier" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <SortableHeader label="Score" field="lead_score" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <SortableHeader label="Current Assignee" field="assigned_agent" sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#7b7166] uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#7b7166] uppercase tracking-wider">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0e8de]">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[#96897c]">Loading leads...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[#96897c]">No leads found matching filters</td></tr>
              ) : (
                leads.map(lead => (
                  <tr key={lead.id} className={`hover:bg-[#faf7f3] transition-colors ${selected.has(lead.id) ? 'bg-orange-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        className="w-4 h-4 rounded border-[#e1d3c2] text-[#c86f43] focus:ring-[#c86f43]/30"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-[#2b241e]">{lead.name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[#5a4e42]">{lead.phone_number ?? '—'}</td>
                    <td className="px-4 py-3">
                      {lead.priority_tier ? (
                        <select
                          value={lead.priority_tier}
                          onChange={(e) => handlePriorityChange(lead.id, e.target.value)}
                          disabled={!canEditPriority || updatingPriorityId === lead.id}
                          className={`px-2 py-1 text-xs font-bold rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 disabled:opacity-50 cursor-pointer ${TIER_COLORS[lead.priority_tier] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}
                        >
                          {PRIORITY_OPTIONS_FULL.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#5a4e42]">{lead.lead_score ?? '—'}</td>
                    <td className="px-4 py-3">
                      {lead.assigned_agent ? (
                        <span className="px-2 py-1 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg">
                          {lead.assigned_agent}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.action_taken ? (
                        <span className="text-xs text-[#5a4e42]">{lead.action_taken}</span>
                      ) : lead.dnd_flag ? (
                        <span className="text-xs text-red-600 font-medium">DNC</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#96897c]">
                      {lead.updated_at ? new Date(lead.updated_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e8ddcf] bg-[#faf7f3]">
            <span className="text-xs text-[#7b7166]">
              Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, totalLeads)} of {totalLeads}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs rounded-lg border border-[#e1d3c2] disabled:opacity-40 hover:bg-[#f0e8de] transition-colors"
              >
                ← Previous
              </button>
              <span className="px-3 py-1.5 text-xs font-medium text-[#5a4e42]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs rounded-lg border border-[#e1d3c2] disabled:opacity-40 hover:bg-[#f0e8de] transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reassignment Warning Modal */}
      {showReassignmentWarning && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e8ddcf] w-full max-w-lg p-6">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-lg font-semibold text-[#2b241e] mb-1">Reassignment Warning</h3>
                <p className="text-sm text-[#7b7166]">
                  {checkReassignments()} of the selected leads are already assigned to another agent.
                  Reassigning will override the current assignment.
                </p>
              </div>
            </div>

            <label className="block text-sm font-medium text-[#7b7166] mb-2">
              Reason for reassignment (required, min 20 characters)
            </label>
            <textarea
              value={reassignmentReason}
              onChange={e => setReassignmentReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[#e1d3c2] rounded-xl text-sm focus:outline-none focus:border-[#c86f43] mb-4"
              placeholder="Explain why these leads are being reassigned..."
            />

            <div className="flex gap-3">
              <button
                onClick={() => { setShowReassignmentWarning(false); setReassignmentReason('') }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#e1d3c2] text-[#6e6357] font-medium hover:bg-[#f0e8de] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performAssign(reassignmentReason)}
                disabled={reassignmentReason.length < 20 || assigning}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#c86f43] text-white font-semibold hover:bg-[#a65630] transition-colors disabled:opacity-50"
              >
                {assigning ? 'Reassigning...' : 'Confirm Reassignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e8ddcf] w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-[#2b241e] mb-1">Assign Leads to Agent</h3>
            <p className="text-sm text-[#7b7166] mb-4">{selected.size} lead{selected.size > 1 ? 's' : ''} selected</p>

            <select
              value={targetAgentId}
              onChange={e => setTargetAgentId(e.target.value)}
              className="w-full px-3 py-3 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:border-[#c86f43] mb-4"
            >
              <option value="">Select an agent...</option>
              {agents?.filter((a: Agent) => a.is_active && a.role !== 'admin').map((a: Agent) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role}) — {agentLeadCounts[a.name] ?? 0} leads assigned
                </option>
              ))}
            </select>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowAssignModal(false); setTargetAgentId('') }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#e1d3c2] text-[#6e6357] font-medium hover:bg-[#f0e8de] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!targetAgentId || assigning}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#c86f43] text-white font-semibold hover:bg-[#a65630] transition-colors disabled:opacity-50"
              >
                {assigning ? 'Assigning...' : `Assign ${selected.size} leads`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SortableHeader({ label, field, sortBy, sortDir, onClick }: {
  label: string
  field: string
  sortBy: string
  sortDir: string
  onClick: (field: string) => void
}) {
  const active = sortBy === field
  return (
    <th
      onClick={() => onClick(field)}
      className="px-4 py-3 text-left text-xs font-semibold text-[#7b7166] uppercase tracking-wider cursor-pointer hover:text-[#4f453b] transition-colors select-none"
    >
      <span className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-30'}`}>
          {active && sortDir === 'desc' ? '↓' : '↑'}
        </span>
      </span>
    </th>
  )
}
