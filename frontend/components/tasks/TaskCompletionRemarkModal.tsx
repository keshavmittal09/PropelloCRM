'use client'

import { useState, useEffect } from 'react'
import { Lead, Task } from '@/lib/types'

interface TaskCompletionRemarkModalProps {
  isOpen: boolean
  lead: Lead | null
  task: Task | null
  onClose: () => void
  onComplete: (remark: string, tags: string[]) => Promise<void>
}

const PRESET_CHIPS = [
  { label: '✅ Site visit confirmed', value: 'site_visit_confirmed' },
  { label: '📞 Callback requested', value: 'callback_requested' },
  { label: '❌ Not interested', value: 'not_interested' },
  { label: '🕐 Out of station / will call back', value: 'out_of_station' },
  { label: '💬 Shared brochure on WhatsApp', value: 'brochure_shared' },
  { label: '🏠 Config discussed (2BHK / 3BHK)', value: 'config_discussed' },
  { label: '💰 Budget concern raised', value: 'budget_concern' },
  { label: '📵 Number not reachable', value: 'number_not_reachable' },
  { label: '🔄 Transfer to senior agent', value: 'transfer_to_senior' },
  { label: '📝 Lead info updated', value: 'lead_info_updated' },
]

const MIN_CHARS = 80

export default function TaskCompletionRemarkModal({
  isOpen,
  lead,
  task,
  onClose,
  onComplete,
}: TaskCompletionRemarkModalProps) {
  const [remark, setRemark] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showDncPrompt, setShowDncPrompt] = useState(false)
  const [showEditDrawer, setShowEditDrawer] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setRemark('')
      setSelectedTags([])
      setShowDncPrompt(false)
    }
  }, [isOpen])

  const handleChipClick = (chip: typeof PRESET_CHIPS[0]) => {
    if (selectedTags.includes(chip.value)) {
      setSelectedTags(selectedTags.filter(t => t !== chip.value))
      // Remove tag from remark text
      setRemark(remark.replace(`[${chip.label}] `, ''))
    } else {
      setSelectedTags([...selectedTags, chip.value])
      // Prepend tag to remark
      setRemark(`[${chip.label}] ${remark}`)
    }
  }

  const handleSubmit = async () => {
    // If agent marked 'Not interested', skip further prompts and submit immediately
    if (selectedTags.includes('not_interested')) {
      setLoading(true)
      try {
        // Minimal remark allowed for Not Interested
        const niRemark = remark && remark.length > 0 ? remark : 'Not interested'
        await onComplete(niRemark, selectedTags)
        onClose()
      } catch (error) {
        console.error('Failed to complete task:', error)
      } finally {
        setLoading(false)
      }
      return
    }

    if (remark.length < MIN_CHARS) return

    setLoading(true)
    try {
      await onComplete(remark, selectedTags)

      // Check if "Not interested" tag was selected (handled above)
      onClose()
    } catch (error) {
      console.error('Failed to complete task:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDncConfirm = async (markDnc: boolean) => {
    if (markDnc) {
      // Flag lead as DNC - this would be handled by parent component
      window.dispatchEvent(new CustomEvent('lead-dnc-flag', {
        detail: { leadId: lead?.id, markDnc: true }
      }))
    }
    onClose()
  }

  if (!isOpen) return null

  // DNC Prompt Modal
  if (showDncPrompt) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-md mx-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Mark this lead as DNC?
          </h3>
          <p className="text-gray-600 mb-6">
            This will set the lead to Do Not Call status and downgrade priority to P5.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => handleDncConfirm(true)}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Yes, Mark as DNC
            </button>
            <button
              onClick={() => handleDncConfirm(false)}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              No, Keep Active
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
      {/* Header */}
      <div className="bg-gray-50 border-b px-6 py-4 sticky top-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Task Completion — {lead?.contact?.name || 'Lead'} | {lead?.contact?.phone || ''}
            </h2>
            <p className="text-sm text-gray-600 mt-1">{task?.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Section A: Preset Chips */}
        <section className="mb-8">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Quick Select Tags (Optional)
          </h3>
          <div className="flex flex-wrap gap-2">
            {PRESET_CHIPS.map((chip) => (
              <button
                key={chip.value}
                onClick={() => handleChipClick(chip)}
                className={`px-3 py-2 rounded-full text-sm font-medium transition-colors
                  ${selectedTags.includes(chip.value)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </section>

        {/* Section B: Remark Textarea */}
        <section className="mb-8">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Call Remark <span className="text-red-500">*</span>
          </h3>
          <div className="relative">
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="What happened on this call? What did the lead say? What's the next step?"
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <div className="absolute bottom-3 right-3 text-sm">
              <span className={remark.length >= MIN_CHARS ? 'text-green-600' : 'text-gray-400'}>
                {remark.length} / {MIN_CHARS} min chars
              </span>
            </div>
          </div>
          {remark.length < MIN_CHARS && (
            <p className="text-sm text-red-600 mt-2">
              Please write at least {MIN_CHARS} characters describing the call outcome.
            </p>
          )}
        </section>

        {/* Section C: Edit Lead Button */}
        <section className="mb-8">
          <button
            onClick={() => setShowEditDrawer(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <span>✏️</span>
            Edit Lead Details
          </button>
        </section>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-6 py-4">
        <div className="max-w-4xl mx-auto flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={remark.length < MIN_CHARS || loading}
            className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors
              ${remark.length >= MIN_CHARS && !loading
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
          >
            {loading ? 'Completing...' : 'Submit & Complete Task'}
          </button>
        </div>
      </div>

      {/* Edit Lead Drawer */}
      {showEditDrawer && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-xl z-50 overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Edit Lead Details</h3>
              <button
                onClick={() => setShowEditDrawer(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ✕
              </button>
            </div>
            {/* Lead edit form would go here - using existing EditLeadDrawer component */}
            <p className="text-gray-600">Lead editing functionality...</p>
          </div>
        </div>
      )}
    </div>
  )
}
