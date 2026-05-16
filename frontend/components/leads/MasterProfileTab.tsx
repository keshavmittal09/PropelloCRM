'use client'
import { useState, useEffect, useCallback } from 'react'
import { useMasterProfile } from '@/hooks/useQueries'
import { leadsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import type { MasterProfile } from '@/lib/types'
import toast from 'react-hot-toast'

interface Props {
  leadId: string
}

const AI_FIELDS: { key: keyof MasterProfile; label: string }[] = [
  { key: 'config_preference', label: 'Config Preference' },
  { key: 'budget_range', label: 'Budget Range' },
  { key: 'site_visit_intent', label: 'Site Visit Intent' },
  { key: 'primary_language', label: 'Primary Language' },
  { key: 'objection_type', label: 'Objection Type' },
  { key: 'intent_level', label: 'Intent Level' },
]

const MANUAL_FIELDS: { key: keyof MasterProfile; label: string; type?: string; options?: string[] }[] = [
  { key: 'full_name', label: 'Full Name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'alternate_phone', label: 'Alternate Phone' },
  { key: 'city', label: 'City' },
  { key: 'locality', label: 'Locality' },
  { key: 'occupation', label: 'Occupation', options: ['Salaried', 'Business', 'Retired', 'Other'] },
  { key: 'occupation_other', label: 'Occupation (Other)' },
  { key: 'family_size', label: 'Family Size', type: 'number' },
  { key: 'current_living_situation', label: 'Current Living', options: ['Renting', 'Owned', 'Other'] },
  { key: 'investment_purpose', label: 'Investment Purpose', options: ['Self-use', 'Investment', 'Both'] },
  { key: 'source', label: 'Source', options: ['Expo', 'Online Ad', 'Referral', 'Cold Call', 'Other'] },
  { key: 'age_range', label: 'Age Range' },
  { key: 'income_range', label: 'Monthly Income' },
  { key: 'property_budget', label: 'Property Budget' },
  { key: 'preferred_location', label: 'Preferred Location' },
  { key: 'purchase_timeline', label: 'Purchase Timeline' },
]

const COMPUTED_FIELDS: { key: keyof MasterProfile; label: string; format?: (v: unknown) => string }[] = [
  { key: 'total_calls', label: 'Total Calls' },
  { key: 'first_contact_date', label: 'First Contact', format: (v) => v ? new Date(v as string).toLocaleDateString('en-IN') : '—' },
  { key: 'last_contact_date', label: 'Last Contact', format: (v) => v ? new Date(v as string).toLocaleDateString('en-IN') : '—' },
  { key: 'days_in_pipeline', label: 'Days in Pipeline', format: (v) => `${v ?? 0} days` },
  { key: 'completion_rate', label: 'Task Completion Rate', format: (v) => `${v ?? 0}%` },
]

export function MasterProfileTab({ leadId }: Props) {
  const { data: profile, isLoading } = useMasterProfile(leadId)
  const qc = useQueryClient()
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [agentNotes, setAgentNotes] = useState('')
  const [priorityOverride, setPriorityOverride] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [savingSection, setSavingSection] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      setAgentNotes(profile.agent_notes ?? '')
      setPriorityOverride(profile.priority_override ?? '')
      setOverrideReason(profile.priority_override_reason ?? '')
    }
  }, [profile])

  const saveField = useCallback(async (key: string, value: unknown) => {
    try {
      await leadsApi.updateMasterProfile(leadId, { [key]: value })
      qc.invalidateQueries({ queryKey: ['master-profile', leadId] })
      toast.success('Field saved')
      setEditingField(null)
    } catch {
      toast.error('Failed to save')
    }
  }, [leadId, qc])

  const saveSection = async (section: string, data: Partial<MasterProfile>) => {
    setSavingSection(section)
    try {
      await leadsApi.updateMasterProfile(leadId, data)
      qc.invalidateQueries({ queryKey: ['master-profile', leadId] })
      toast.success('Section saved')
    } catch {
      toast.error('Failed to save section')
    } finally {
      setSavingSection(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-2 border-[#c86f43] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!profile) {
    return <p className="text-sm text-gray-400 py-8 text-center">Unable to load master profile</p>
  }

  return (
    <div className="space-y-8">
      {/* Lead Information (Manual) */}
      <div className="space-y-4">
        <SectionHeader title="Lead Information" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {MANUAL_FIELDS.map(field => (
            <EditableField
              key={field.key}
              label={field.label}
              value={profile[field.key] as string | null}
              fieldKey={field.key}
              type={field.type}
              options={field.options}
              isEditing={editingField === field.key}
              editValue={editValue}
              onStartEdit={() => {
                setEditingField(field.key)
                setEditValue(String(profile[field.key] ?? ''))
              }}
              onEditChange={setEditValue}
              onSave={() => saveField(field.key, field.type === 'number' ? Number(editValue) : editValue)}
              onCancel={() => setEditingField(null)}
            />
          ))}
        </div>
      </div>

      <div className="h-px w-full bg-[#e8ddcf]" />

      {/* AI Analysis */}
      <div className="space-y-4">
        <SectionHeader title="AI Analysis" badge="AI" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {AI_FIELDS.map(field => (
            <ProfileCard
              key={field.key}
              label={field.label}
              value={profile[field.key] as string | null}
              isAI
            />
          ))}
        </div>
        
        {/* Full-width AI Summaries */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          {profile.ai_summary && (
            <div className="crm-surface rounded-xl p-4 border border-[#e8ddcf]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-[#7b7166]">AI Summary</span>
                <AIBadge />
              </div>
              <p className="text-sm text-[#4f453b] leading-relaxed">{profile.ai_summary}</p>
            </div>
          )}
          {profile.key_quote && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-amber-700">Key Quote</span>
                <AIBadge />
              </div>
              <p className="text-sm text-amber-800 italic">&ldquo;{profile.key_quote}&rdquo;</p>
            </div>
          )}
        </div>
      </div>

      <div className="h-px w-full bg-[#e8ddcf]" />

      {/* Computed Stats + Workflow */}
      <div className="space-y-4">
        <SectionHeader title="Pipeline & Activity" />
        
        {/* Pipeline Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          {COMPUTED_FIELDS.map(field => (
            <ProfileCard
              key={field.key}
              label={field.label}
              value={field.format ? field.format(profile[field.key]) : String(profile[field.key] ?? '—')}
              isComputed
            />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Last Call Summary */}
          <div className="crm-surface border border-[#e8ddcf] rounded-xl p-4 space-y-3 col-span-1">
            <p className="text-xs font-semibold text-[#7b7166] uppercase">Last Call Summary</p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#8f8378]">Status</span>
                <span className="font-medium text-[#2b241e]">{profile.last_call_status ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#8f8378]">Interest</span>
                <span className="font-medium text-[#2b241e]">{profile.last_call_interest ?? '—'}</span>
              </div>
              {(profile.last_call_topics ?? []).length > 0 && (
                <div className="pt-1">
                  <p className="text-[#8f8378] text-xs mb-1.5">Topics Discussed</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.last_call_topics.map((t: string) => (
                      <span key={t} className="px-2 py-0.5 bg-[#f0e8de] text-[#6e6357] rounded-full text-xs font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent Notes */}
          <div className="crm-surface border border-[#e8ddcf] rounded-xl p-4 space-y-3 col-span-1">
            <label className="text-xs font-semibold text-[#7b7166] uppercase">Agent Notes</label>
            <textarea
              value={agentNotes}
              onChange={e => setAgentNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[#e1d3c2] rounded-lg text-sm resize-none focus:outline-none focus:border-[#c86f43] focus:ring-1 focus:ring-[#c86f43]/30"
              placeholder="Add your observations about this lead..."
            />
            <button
              onClick={() => saveSection('notes', { agent_notes: agentNotes })}
              disabled={savingSection === 'notes'}
              className="w-full py-2 rounded-lg bg-[#2f2317] text-white text-sm font-medium hover:bg-[#1f1610] transition-colors disabled:opacity-50"
            >
              {savingSection === 'notes' ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          {/* Priority Override */}
          <div className="crm-surface border border-[#e8ddcf] rounded-xl p-4 space-y-3 col-span-1">
            <label className="text-xs font-semibold text-[#7b7166] uppercase">Priority Override</label>
            <select
              value={priorityOverride}
              onChange={e => setPriorityOverride(e.target.value)}
              className="w-full px-3 py-2 border border-[#e1d3c2] rounded-lg text-sm bg-white focus:outline-none focus:border-[#c86f43]"
            >
              <option value="">No override (use AI tier)</option>
              <option value="P1">P1 — Highest</option>
              <option value="P2">P2 — High</option>
              <option value="P3">P3 — Medium</option>
              <option value="P4">P4 — Low</option>
              <option value="P5">P5 — Lowest</option>
            </select>
            <input
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder="Reason for override..."
              className="w-full px-3 py-2 border border-[#e1d3c2] rounded-lg text-sm focus:outline-none focus:border-[#c86f43]"
            />
            <button
              onClick={() => saveSection('priority', { priority_override: priorityOverride, priority_override_reason: overrideReason })}
              disabled={savingSection === 'priority'}
              className="w-full py-2 rounded-lg bg-[#2f2317] text-white text-sm font-medium hover:bg-[#1f1610] transition-colors disabled:opacity-50"
            >
              {savingSection === 'priority' ? 'Saving...' : 'Save Priority'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h4 className="text-sm font-semibold text-[#2b241e]">{title}</h4>
      {badge && <AIBadge />}
    </div>
  )
}

function AIBadge() {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-bold text-white bg-gradient-to-r from-violet-500 to-purple-600 rounded-md shadow-sm">
      AI
    </span>
  )
}

function ProfileCard({ label, value, isAI, isComputed }: {
  label: string
  value: string | null | undefined
  isAI?: boolean
  isComputed?: boolean
}) {
  return (
    <div className={`rounded-xl px-4 py-3 border ${
      isAI ? 'bg-violet-50/50 border-violet-100' :
      isComputed ? 'bg-blue-50/50 border-blue-100' :
      'bg-white border-[#e8ddcf]'
    }`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs text-[#96897c]">{label}</span>
        {isAI && <AIBadge />}
      </div>
      <p className={`text-sm font-medium ${value ? 'text-[#2b241e]' : 'text-gray-400'}`}>
        {value ?? '—'}
      </p>
    </div>
  )
}

function EditableField({
  label, value, fieldKey, type, options,
  isEditing, editValue, onStartEdit, onEditChange, onSave, onCancel,
}: {
  label: string
  value: string | null | undefined
  fieldKey: string
  type?: string
  options?: string[]
  isEditing: boolean
  editValue: string
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-xl px-4 py-3 border bg-white border-[#e8ddcf] group relative">
      <span className="text-xs text-[#96897c] block mb-1">{label}</span>
      {isEditing ? (
        <div className="flex gap-2">
          {options ? (
            <select
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              className="flex-1 bg-white border border-[#e1d3c2] rounded-lg text-sm px-2 py-1 focus:outline-none focus:border-[#c86f43]"
            >
              <option value="">Select...</option>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={type || 'text'}
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              className="flex-1 bg-white border border-[#e1d3c2] rounded-lg text-sm px-2 py-1 focus:outline-none focus:border-[#c86f43]"
            />
          )}
          <button onClick={onSave} className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1 bg-emerald-50 rounded-lg">✓</button>
          <button onClick={onCancel} className="text-xs font-bold text-gray-500 hover:text-gray-700 px-2 py-1 bg-gray-50 rounded-lg">✕</button>
        </div>
      ) : (
        <div className="flex justify-between items-center">
          <p className={`text-sm font-medium ${value ? 'text-[#2b241e]' : 'text-gray-400'}`}>
            {value ?? 'Not set'}
          </p>
          <button
            onClick={onStartEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-[#c86f43] font-medium"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  )
}
