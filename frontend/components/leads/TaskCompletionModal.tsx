'use client'
import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tasksApi, leadsApi } from '@/lib/api'
import type { Task, Lead } from '@/lib/types'
import { EditLeadDrawer } from './EditLeadDrawer'
import toast from 'react-hot-toast'

const PRESET_CHIPS = [
  { emoji: '✅', label: 'Site visit confirmed', tag: '[Site Visit Confirmed]' },
  { emoji: '📞', label: 'Callback requested', tag: '[Callback Requested]' },
  { emoji: '❌', label: 'Not interested', tag: '[Not Interested]' },
  { emoji: '🕐', label: 'Out of station / will call back', tag: '[Out of Station]' },
  { emoji: '💬', label: 'Shared brochure on WhatsApp', tag: '[Brochure Shared]' },
  { emoji: '🏠', label: 'Config discussed (2BHK / 3BHK)', tag: '[Config Discussed]' },
  { emoji: '💰', label: 'Budget concern raised', tag: '[Budget Concern]' },
  { emoji: '📵', label: 'Number not reachable', tag: '[Not Reachable]' },
  { emoji: '🔄', label: 'Transfer to senior agent', tag: '[Transfer Requested]' },
  { emoji: '📝', label: 'Lead info updated', tag: '[Lead Updated]' },
]

const MIN_CHARS = 80

interface Props {
  task: Task
  lead: Lead | null
  onClose: () => void
  onComplete: () => void
}

export function TaskCompletionModal({ task, lead, onClose, onComplete }: Props) {
  const qc = useQueryClient()
  const [remark, setRemark] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [showDncPrompt, setShowDncPrompt] = useState(false)
  const [leadData, setLeadData] = useState<Lead | null>(lead ?? task.lead ?? null)

  const charCount = remark.length
  const canSubmit = charCount >= MIN_CHARS && !submitting

  const leadName = leadData?.contact?.name ?? 'Lead'
  const leadPhone = leadData?.contact?.phone ?? ''

  // Refresh lead data when drawer closes
  const refreshLead = useCallback(async () => {
    if (!task.lead_id) return
    try {
      const fresh = await leadsApi.get(task.lead_id)
      setLeadData(fresh)
      qc.invalidateQueries({ queryKey: ['lead', task.lead_id] })
    } catch { /* ignore */ }
  }, [task.lead_id, qc])

  useEffect(() => {
    setLeadData(lead ?? task.lead ?? null)
  }, [lead, task.lead])

  const toggleChip = (tag: string, label: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(prev => prev.filter(t => t !== tag))
      setRemark(prev => prev.replace(tag + ' ', '').replace(tag, ''))
    } else {
      setSelectedTags(prev => [...prev, tag])
      setRemark(prev => (prev ? `${tag} ${prev}` : `${tag} `))
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await tasksApi.completeWithRemark(task.id, {
        remark_text: remark,
        preset_tags: selectedTags,
      })
      toast.success('Task completed with remark')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['timeline', task.lead_id] })
      qc.invalidateQueries({ queryKey: ['lead', task.lead_id] })

      // Check if "Not interested" chip was selected
      if (selectedTags.includes('[Not Interested]') && leadData) {
        setShowDncPrompt(true)
        return
      }

      onComplete()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      toast.error(err?.response?.data?.detail ?? 'Failed to complete task')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDnc = async (markDnd: boolean) => {
    if (markDnd && leadData) {
      try {
        await tasksApi.flagDnc({ lead_id: leadData.id, mark_dnd: true })
        toast.success('Lead marked as DNC (Do Not Call)')
      } catch {
        toast.error('Failed to mark lead as DNC')
      }
    }
    setShowDncPrompt(false)
    onComplete()
  }

  // DNC prompt sub-modal
  if (showDncPrompt) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl border border-[#e8ddcf] p-8 max-w-md w-full mx-4 animate-in fade-in">
          <div className="text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-semibold text-[#2b241e] mb-2">Mark as Do Not Call?</h3>
            <p className="text-sm text-[#7b7166] mb-6">
              This lead was marked as &quot;Not Interested&quot;. Would you like to flag them as DNC?
              This will set the lead priority to P5 and prevent future outreach.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => handleDnc(false)}
              className="flex-1 px-5 py-3 rounded-xl border border-[#e1d3c2] text-[#6e6357] font-medium hover:bg-[#f8eee3] transition-colors"
            >
              No, keep active
            </button>
            <button
              onClick={() => handleDnc(true)}
              className="flex-1 px-5 py-3 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
            >
              Yes, mark DNC
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-auto py-6 px-4">
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-[#e8ddcf] flex flex-col max-h-[95vh]">
          {/* Header */}
          <div className="px-8 py-6 border-b border-[#e8ddcf] bg-gradient-to-r from-[#fffaf4] to-[#f7f0e8]">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow-md">
                ✏️
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-[#1f1914]">
                  Task Completion
                </h2>
                <p className="text-sm text-[#7b7166] mt-0.5">
                  <span className="font-medium text-[#4f453b]">{leadName}</span>
                  {leadPhone && <> &middot; <span className="font-mono">{leadPhone}</span></>}
                </p>
              </div>
            </div>
            <p className="text-xs text-[#96897c] mt-2 ml-[52px]">
              Task: <span className="font-medium">{task.title}</span>
            </p>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
            {/* Section B — Preset Chips */}
            <div>
              <label className="text-xs font-semibold text-[#7b7166] uppercase tracking-wider mb-3 block">
                Quick Tags (optional)
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESET_CHIPS.map(chip => {
                  const active = selectedTags.includes(chip.tag)
                  return (
                    <button
                      key={chip.tag}
                      onClick={() => toggleChip(chip.tag, chip.label)}
                      className={`
                        px-3.5 py-2 rounded-full text-sm font-medium border transition-all duration-200
                        ${active
                          ? 'bg-[#2f2317] text-white border-[#2f2317] shadow-md scale-[1.02]'
                          : 'bg-white text-[#4f453b] border-[#e1d3c2] hover:border-[#c9b9a4] hover:bg-[#faf5ef]'
                        }
                      `}
                    >
                      <span className="mr-1.5">{chip.emoji}</span>
                      {chip.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Section A — Remark textarea */}
            <div>
              <label className="text-xs font-semibold text-[#7b7166] uppercase tracking-wider mb-2 block">
                Call / Interaction Remark <span className="text-red-500">*</span>
              </label>
              <textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={5}
                placeholder="What happened on this call? What did the lead say? Next step?"
                className="w-full px-4 py-3 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43] transition-all resize-none"
              />
              <div className="flex items-center justify-between mt-2">
                <p className={`text-xs font-medium transition-colors ${
                  charCount >= MIN_CHARS ? 'text-green-600' : charCount >= MIN_CHARS * 0.7 ? 'text-amber-600' : 'text-[#96897c]'
                }`}>
                  {charCount} / {MIN_CHARS} characters minimum
                  {charCount >= MIN_CHARS && ' ✓'}
                </p>
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      charCount >= MIN_CHARS ? 'bg-green-500' : charCount >= MIN_CHARS * 0.7 ? 'bg-amber-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${Math.min(100, (charCount / MIN_CHARS) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Section C — Edit Lead */}
            <div>
              <button
                onClick={() => setShowDrawer(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[#d4c5b2] text-sm font-medium text-[#5a4e42] hover:bg-[#faf5ef] hover:border-[#c86f43] transition-all"
              >
                ✏️ Edit Lead Details
                <span className="text-xs text-[#96897c]">Update name, phone, config preference, etc.</span>
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-5 border-t border-[#e8ddcf] bg-[#faf7f3] flex items-center justify-between gap-4 rounded-b-2xl">
            <button
              onClick={onClose}
              className="px-6 py-3 rounded-xl border border-[#e1d3c2] text-[#6e6357] font-medium hover:bg-[#f0e8de] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`
                px-8 py-3 rounded-xl font-semibold text-white transition-all duration-200
                ${canSubmit
                  ? 'bg-gradient-to-r from-[#c86f43] to-[#a65630] hover:shadow-lg hover:shadow-[#c86f43]/25 hover:-translate-y-0.5'
                  : 'bg-gray-300 cursor-not-allowed'
                }
              `}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </span>
              ) : (
                'Submit & Complete Task'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Edit Lead Side Drawer */}
      {showDrawer && leadData && (
        <EditLeadDrawer
          lead={leadData}
          onClose={() => {
            setShowDrawer(false)
            refreshLead()
          }}
        />
      )}
    </>
  )
}
