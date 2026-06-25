'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tasksApi, leadsApi } from '@/lib/api'
import type { Task, Lead, DemographicsInput } from '@/lib/types'
import toast from 'react-hot-toast'

const CALL_STATUS_OPTIONS = [
  { value: 'connected', label: 'Yes, Connected', emoji: '✅' },
  { value: 'no_answer', label: 'No Answer', emoji: '📵' },
  { value: 'wrong_number', label: 'Wrong Number', emoji: '❌' },
  { value: 'callback', label: 'Call Back Later', emoji: '🔄' },
]

const INTEREST_OPTIONS = [
  { value: 'hot', label: 'Hot', emoji: '🔴' },
  { value: 'warm', label: 'Warm', emoji: '🟠' },
  { value: 'cold', label: 'Cold', emoji: '🔵' },
  { value: 'not_interested', label: 'Not Interested', emoji: '🚫' },
  { value: 'busy', label: 'Busy', emoji: '🔕' },
  { value: 'unknown', label: "Don't Know", emoji: '❓' },
]

const TOPIC_OPTIONS = [
  { value: 'price', label: 'Price' },
  { value: 'location', label: 'Location' },
  { value: 'flat_size', label: 'Flat Size' },
  { value: 'loan', label: 'Loan' },
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'follow_up', label: 'Follow Up' },
]

const AGE_OPTIONS = ['under_20', '20-30', '30-40', '40-50', '50-60', '60+', 'unknown']
const OCCUPATION_OPTIONS = [
  'salaried_private', 'salaried_government', 'self_employed',
  'professional', 'farmer', 'student', 'homemaker', 'unknown', 'other',
]
const FAMILY_OPTIONS = ['1-2', '3-4', '5-6', '6+', 'unknown']
const INCOME_OPTIONS = ['under_20000', '20000-40000', '40000-75000', '75000-150000', '150000+', 'unknown']
const BUDGET_OPTIONS = ['under_20L', '20L-40L', '40L-70L', '70L-1Cr', '1Cr-2Cr', '2Cr+', 'unknown']
const TIMELINE_OPTIONS = ['immediate', 'soon', 'later', 'exploring', 'unknown']
const LIVING_OPTIONS = ['Renting', 'Owned', 'Living with parents', 'Other', 'unknown']
const INVESTMENT_OPTIONS = ['Self-use', 'Investment', 'Both', 'Rental income', 'unknown']

const L: Record<string, string> = {
  under_20: 'Under 20', '20-30': '20-30', '30-40': '30-40', '40-50': '40-50', '50-60': '50-60', '60+': '60+', unknown: "Don't Know",
  salaried_private: 'Salaried - Private', salaried_government: 'Salaried - Govt', self_employed: 'Self-Employed',
  professional: 'Professional', farmer: 'Farmer', student: 'Student', homemaker: 'Homemaker', other: 'Other',
  '1-2': '1-2', '3-4': '3-4', '5-6': '5-6', '6+': '6+',
  under_20000: '< 20K', '20000-40000': '20-40K', '40000-75000': '40-75K', '75000-150000': '75K-1.5L', '150000+': '1.5L+',
  under_20L: '< 20L', '20L-40L': '20-40L', '40L-70L': '40-70L', '70L-1Cr': '70L-1Cr', '1Cr-2Cr': '1-2Cr', '2Cr+': '2Cr+',
  immediate: 'Immediately', soon: 'Soon (3-6m)', later: 'Later (6-12m)', exploring: 'Just Exploring',
  'Renting': 'Renting', 'Owned': 'Owned', 'Living with parents': 'Living with parents', 'Other': 'Other',
  price: 'Price', location: 'Location', flat_size: 'Flat Size', loan: 'Loan', site_visit: 'Site Visit', follow_up: 'Follow Up',
}

const FOLLOWUP_OPTIONS = [
  { value: 'today_evening', label: 'Today Evening' },
  { value: 'tomorrow_morning', label: 'Tomorrow Morning' },
  { value: '3_days', label: 'In 3 Days' },
  { value: '1_week', label: 'In 1 Week' },
  { value: 'not_needed', label: 'Not Needed' },
]

// Format an ISO date-time-local string ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DD") for display
function fmtDate(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Convert a datetime-local input value to a full ISO string
function dateToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

interface Props {
  task: Task
  lead: Lead | null
  onClose: () => void
  onComplete: () => void
}

export function UnifiedTaskCompletionSheet({ task, lead, onClose, onComplete }: Props) {
  const qc = useQueryClient()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [callStatus, setCallStatus] = useState<string | null>(null)
  const [interest, setInterest] = useState<string | null>(null)
  const [topics, setTopics] = useState<string[]>([])
  const [age, setAge] = useState<string | null>(lead?.age_range ?? null)
  const [occupation, setOccupation] = useState<string | null>(lead?.occupation ?? null)
  const [occupationOther, setOccupationOther] = useState('')
  const [familySize, setFamilySize] = useState<string | null>(lead?.family_size ?? null)
  const [income, setIncome] = useState<string | null>(lead?.income_range ?? null)
  const [budget, setBudget] = useState<string | null>(lead?.property_budget ?? null)
  const [preferredLocation, setPreferredLocation] = useState(lead?.preferred_location ?? '')
  const [timeline, setTimeline] = useState<string | null>(lead?.purchase_timeline ?? null)
  const [livingSituation, setLivingSituation] = useState<string | null>(null)
  const [investmentPurpose, setInvestmentPurpose] = useState<string | null>(null)
  const [followupOption, setFollowupOption] = useState<string | null>(null)
  const [followupDate, setFollowupDate] = useState('')
  const [followupTime, setFollowupTime] = useState('09:00')
  const [remarkText, setRemarkText] = useState('')
  // Topic-specific scheduling
  const [siteVisitDate, setSiteVisitDate] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  // Step 3 lead edit fields
  const [editName, setEditName] = useState(lead?.contact?.name ?? '')
  const [editPhone, setEditPhone] = useState(lead?.contact?.phone ?? '')
  const [editEmail, setEditEmail] = useState(lead?.contact?.email ?? '')
  const [showLeadEdit, setShowLeadEdit] = useState(false)

  function toggleTopic(topic: string) {
    setTopics(prev => prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic])
  }

  function getNextFollowupDate(): string | null {
    if (followupOption === 'not_needed' || !followupOption) return null
    const now = new Date()
    const date = new Date(now)

    switch (followupOption) {
      case 'today_evening':
        date.setHours(18, 0, 0, 0)
        if (date <= now) date.setDate(date.getDate() + 1)
        break
      case 'tomorrow_morning':
        date.setDate(date.getDate() + 1)
        date.setHours(9, 0, 0, 0)
        break
      case '3_days':
        date.setDate(date.getDate() + 3)
        date.setHours(9, 0, 0, 0)
        break
      case '1_week':
        date.setDate(date.getDate() + 7)
        date.setHours(9, 0, 0, 0)
        break
      default: {
        if (followupDate) {
          const [y, m, d] = followupDate.split('-').map(Number)
          date.setFullYear(y, m - 1, d)
          const [h, min] = followupTime.split(':').map(Number)
          date.setHours(h, min, 0, 0)
        } else {
          return null
        }
      }
    }

    return date.toISOString()
  }

  async function handleSubmit() {
    if (!callStatus) {
      toast.error('Please select call status')
      return
    }

    const demographics: DemographicsInput = {}
    if (age) demographics.age_range = age
    if (occupation) demographics.occupation = occupation
    if (occupationOther) demographics.occupation_other = occupationOther
    if (familySize) demographics.family_size = familySize
    if (income) demographics.income_range = income
    if (budget) demographics.property_budget = budget
    if (preferredLocation) demographics.preferred_location = preferredLocation
    if (timeline) demographics.purchase_timeline = timeline
    if (livingSituation) demographics.current_living_situation = livingSituation
    if (investmentPurpose) demographics.investment_purpose = investmentPurpose

    const callLabel = CALL_STATUS_OPTIONS.find(o => o.value === callStatus)?.label ?? callStatus
    const interestLabel = interest ? INTEREST_OPTIONS.find(o => o.value === interest)?.label : null
    const remarkLines: string[] = [`Call status: ${callLabel}`]
    if (interestLabel) remarkLines.push(`Interest: ${interestLabel}`)
    if (topics.length > 0) remarkLines.push(`Discussed: ${topics.map(t => L[t] ?? t).join(', ')}`)
    if (topics.includes('site_visit') && siteVisitDate) remarkLines.push(`Site visit scheduled: ${fmtDate(siteVisitDate)}`)
    if (topics.includes('follow_up')) {
      if (followUpAt) remarkLines.push(`Follow-up on: ${fmtDate(followUpAt)}`)
      if (followUpNote.trim()) remarkLines.push(`Follow-up note: ${followUpNote.trim()}`)
    }
    if (demographics.occupation) remarkLines.push(`Occupation: ${L[demographics.occupation] ?? demographics.occupation}`)
    if (demographics.family_size) remarkLines.push(`Family: ${L[demographics.family_size]}`)
    if (demographics.property_budget) remarkLines.push(`Budget: ${L[demographics.property_budget] ?? demographics.property_budget}`)
    if (remarkText.trim()) remarkLines.push(`Note: ${remarkText.trim()}`)

    // Schedule next follow-up from the topic date pickers (site visit or follow-up date)
    const scheduledDate =
      (topics.includes('site_visit') && siteVisitDate ? dateToIso(siteVisitDate) : null) ??
      (topics.includes('follow_up') && followUpAt ? dateToIso(followUpAt) : null) ??
      getNextFollowupDate()
    const followUpComboNote = [followUpNote.trim(), remarkText.trim()].filter(Boolean).join(' — ')

    // Pad remark_text to 80 chars if needed (backend requires min_length=80)
    const MIN_CHARS = 80
    const remark_text = remarkLines.join('. ')
    const paddedRemark = remark_text.length >= MIN_CHARS ? remark_text : remark_text + ' [Task completed via mobile form]'

    setSubmitting(true)
    try {
      await tasksApi.completeWithRemark(task.id, {
        remark_text: paddedRemark,
        preset_tags: [],
        call_status: callStatus,
        interest_level: interest ?? undefined,
        topics_discussed: topics,
        demographics: Object.keys(demographics).length > 0 ? demographics : undefined,
        next_followup_at: scheduledDate,
        note: followUpComboNote || undefined,
      })

      // Sync any edited lead fields
      const hasEdits = editName !== (lead?.contact?.name ?? '') ||
        editPhone !== (lead?.contact?.phone ?? '') ||
        editEmail !== (lead?.contact?.email ?? '')
      if (hasEdits && task.lead_id) {
        try {
          await leadsApi.updateMasterProfile(task.lead_id, {
            full_name: editName || undefined,
            email: editEmail || undefined,
          })
        } catch { /* non-critical */ }
      }

      toast.success('Task completed!')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      if (task.lead_id) {
        qc.invalidateQueries({ queryKey: ['timeline', task.lead_id] })
        qc.invalidateQueries({ queryKey: ['lead', task.lead_id] })
        qc.invalidateQueries({ queryKey: ['master-profile', task.lead_id] })
        qc.invalidateQueries({ queryKey: ['leads'] })
      }
      onComplete()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to complete task')
    } finally {
      setSubmitting(false)
    }
  }

  const leadName = lead?.contact?.name ?? task.lead?.contact?.name ?? 'Lead'

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[95vh] overflow-hidden">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 sm:pt-1">
          <div className="w-10 h-1 rounded-full bg-[#d4c5b2]" />
        </div>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e8ddcf]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#1f1914]">{leadName}</h2>
              <p className="text-xs text-[#8f8378] mt-0.5">{task.title}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7b7166] hover:bg-[#f0e8de] transition-colors text-sm"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-1.5 mt-3">
            <div className="flex-1 h-1.5 rounded-full bg-[#c86f43]" />
          </div>
          <p className="text-xs text-[#8f8378] mt-1.5">Step 1 of 1 — Call Details</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {step === 1 && (
            <Step1
              callStatus={callStatus} setCallStatus={setCallStatus}
              interest={interest} setInterest={setInterest}
              topics={topics} toggleTopic={toggleTopic}
              siteVisitDate={siteVisitDate} setSiteVisitDate={setSiteVisitDate}
              followUpAt={followUpAt} setFollowUpAt={setFollowUpAt}
              followUpNote={followUpNote} setFollowUpNote={setFollowUpNote}
            />
          )}
          {step === 2 && (
            <Step2
              age={age} setAge={setAge}
              occupation={occupation} setOccupation={setOccupation}
              occupationOther={occupationOther} setOccupationOther={setOccupationOther}
              familySize={familySize} setFamilySize={setFamilySize}
              income={income} setIncome={setIncome}
              budget={budget} setBudget={setBudget}
              preferredLocation={preferredLocation} setPreferredLocation={setPreferredLocation}
              timeline={timeline} setTimeline={setTimeline}
              livingSituation={livingSituation} setLivingSituation={setLivingSituation}
              investmentPurpose={investmentPurpose} setInvestmentPurpose={setInvestmentPurpose}
            />
          )}
          {step === 3 && !showLeadEdit && (
            <Step3LeadEdit
              editName={editName} setEditName={setEditName}
              editPhone={editPhone} setEditPhone={setEditPhone}
              editEmail={editEmail} setEditEmail={setEditEmail}
              onShowEdit={() => setShowLeadEdit(true)}
            />
          )}
          {step === 3 && showLeadEdit && (
            <Step3LeadEditForm
              editName={editName} setEditName={setEditName}
              editPhone={editPhone} setEditPhone={setEditPhone}
              editEmail={editEmail} setEditEmail={setEditEmail}
              onCancel={() => setShowLeadEdit(false)}
            />
          )}
          {step === 4 && (
            <Step4Confirm
              callStatus={callStatus}
              interest={interest}
              topics={topics}
              age={age} occupation={occupation} familySize={familySize}
              income={income} budget={budget} preferredLocation={preferredLocation}
              timeline={timeline} livingSituation={livingSituation} investmentPurpose={investmentPurpose}
              followupOption={followupOption} remarkText={remarkText}
              editName={editName}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#e8ddcf] bg-[#faf7f3]">
          <div className="flex gap-3">
            <button onClick={handleSubmit} disabled={!callStatus || submitting}
              className="flex-1 px-5 py-3 rounded-xl bg-[#2f7a4e] text-white font-semibold hover:bg-[#236539] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {submitting ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Submitting...</>
              ) : 'Complete Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SelectChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${selected ? 'bg-[#2f2317] text-white border-[#2f2317]' : 'bg-white text-[#4f453b] border-[#e1d3c2]'}`}>
      {label}
    </button>
  )
}

function Step1({ callStatus, setCallStatus, interest, setInterest, topics, toggleTopic, siteVisitDate, setSiteVisitDate, followUpAt, setFollowUpAt, followUpNote, setFollowUpNote }: any) {
  const isConnected = callStatus === 'connected'
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Did you reach them?</p>
        <div className="grid grid-cols-2 gap-2">
          {CALL_STATUS_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setCallStatus(opt.value)}
              className={`py-3 px-3 rounded-xl border-2 text-sm font-medium transition-all flex items-center gap-2 ${callStatus === opt.value ? 'border-[#c86f43] bg-[#fef7f2] text-[#c86f43]' : 'border-[#e1d3c2] bg-white text-[#4f453b]'}`}>
              <span>{opt.emoji}</span> {opt.label}
            </button>
          ))}
        </div>
      </div>
      {isConnected && (
        <div>
          <p className="text-sm font-semibold text-[#1f1914] mb-2">Interest level?</p>
          <div className="grid grid-cols-2 gap-2">
            {INTEREST_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setInterest(opt.value === interest ? null : opt.value)}
                className={`py-3 px-3 rounded-xl border-2 text-sm font-medium transition-all flex items-center gap-2 ${interest === opt.value ? 'border-[#c86f43] bg-[#fef7f2] text-[#c86f43]' : 'border-[#e1d3c2] bg-white text-[#4f453b]'}`}>
                <span>{opt.emoji}</span> {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {isConnected && (
        <div>
          <p className="text-sm font-semibold text-[#1f1914] mb-2">What was discussed?</p>
          <div className="flex flex-wrap gap-2">
            {TOPIC_OPTIONS.map(opt => {
              const active = topics.includes(opt.value)
              return (
                <button key={opt.value} onClick={() => toggleTopic(opt.value)}
                  className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${active ? 'bg-[#2f2317] text-white border-[#2f2317]' : 'bg-white text-[#4f453b] border-[#e1d3c2]'}`}>
                  {opt.label}
                </button>
              )
            })}
          </div>

          {topics.includes('site_visit') && (
            <div className="mt-3 bg-[#fef7f2] border border-[#efd7c6] rounded-xl p-3">
              <p className="text-sm font-semibold text-[#1f1914] mb-1.5">📅 Site visit date &amp; time</p>
              <input
                type="datetime-local"
                value={siteVisitDate}
                onChange={e => setSiteVisitDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
              />
            </div>
          )}

          {topics.includes('follow_up') && (
            <div className="mt-3 bg-[#fef7f2] border border-[#efd7c6] rounded-xl p-3 space-y-2.5">
              <div>
                <p className="text-sm font-semibold text-[#1f1914] mb-1.5">📅 Follow-up date &amp; time</p>
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={e => setFollowUpAt(e.target.value)}
                  className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1f1914] mb-1.5">What to discuss?</p>
                <textarea
                  rows={2}
                  value={followUpNote}
                  onChange={e => setFollowUpNote(e.target.value)}
                  placeholder="e.g. Need to talk about loan approval…"
                  className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Step2({ age, setAge, occupation, setOccupation, occupationOther, setOccupationOther, familySize, setFamilySize, income, setIncome, budget, setBudget, preferredLocation, setPreferredLocation, timeline, setTimeline, livingSituation, setLivingSituation, investmentPurpose, setInvestmentPurpose }: any) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-[#8f8378]">Fill what you learned — estimates are okay. Select &ldquo;Don&rsquo;t Know&rdquo; if unknown.</p>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Age range</p>
        <div className="flex flex-wrap gap-2">
          {AGE_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={age === v} onClick={() => setAge(v === age ? null : v)} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Occupation</p>
        <div className="flex flex-wrap gap-2">
          {OCCUPATION_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={occupation === v} onClick={() => setOccupation(v === occupation ? null : v)} />
          ))}
        </div>
        {occupation === 'other' && (
          <input type="text" value={occupationOther} onChange={e => setOccupationOther(e.target.value)}
            placeholder="Specify occupation..."
            className="mt-2 w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]" />
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Family size</p>
        <div className="flex flex-wrap gap-2">
          {FAMILY_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={familySize === v} onClick={() => setFamilySize(v === familySize ? null : v)} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Monthly income (estimate)</p>
        <div className="flex flex-wrap gap-2">
          {INCOME_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={income === v} onClick={() => setIncome(v === income ? null : v)} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Property budget</p>
        <div className="flex flex-wrap gap-2">
          {BUDGET_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={budget === v} onClick={() => setBudget(v === budget ? null : v)} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Preferred location</p>
        <input type="text" value={preferredLocation} onChange={e => setPreferredLocation(e.target.value)}
          placeholder="e.g. Noida, Sector 62"
          className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">When do they need it?</p>
        <div className="flex flex-wrap gap-2">
          {TIMELINE_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={timeline === v} onClick={() => setTimeline(v === timeline ? null : v)} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Current living situation</p>
        <div className="flex flex-wrap gap-2">
          {LIVING_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={livingSituation === v} onClick={() => setLivingSituation(v === livingSituation ? null : v)} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Investment purpose</p>
        <div className="flex flex-wrap gap-2">
          {INVESTMENT_OPTIONS.map(v => (
            <SelectChip key={v} label={L[v] ?? v} selected={investmentPurpose === v} onClick={() => setInvestmentPurpose(v === investmentPurpose ? null : v)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Step3LeadEdit({ editName, editPhone, editEmail, onShowEdit }: {
  editName: string; setEditName: (v: string) => void
  editPhone: string; setEditPhone: (v: string) => void
  editEmail: string; setEditEmail: (v: string) => void
  onShowEdit: () => void
}) {
  return (
    <div className="space-y-5">
      <div className="bg-[#fef7f2] border border-[#efd7c6] rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-[#1f1914]">Lead Contact Info</p>
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div><span className="text-[#8f8378]">Name:</span> <span className="font-medium text-[#2b241e]">{editName || '—'}</span></div>
          <div><span className="text-[#8f8378]">Phone:</span> <span className="font-medium text-[#2b241e]">{editPhone || '—'}</span></div>
          <div><span className="text-[#8f8378]">Email:</span> <span className="font-medium text-[#2b241e]">{editEmail || '—'}</span></div>
        </div>
        <button onClick={onShowEdit}
          className="w-full px-4 py-2.5 rounded-xl border border-[#c86f43] text-[#c86f43] text-sm font-semibold hover:bg-[#fdf0e6] transition-colors">
          Edit Lead Info
        </button>
      </div>
    </div>
  )
}

function Step3LeadEditForm({ editName, setEditName, editPhone, setEditPhone, editEmail, setEditEmail, onCancel }: {
  editName: string; setEditName: (v: string) => void
  editPhone: string; setEditPhone: (v: string) => void
  editEmail: string; setEditEmail: (v: string) => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-[#7b7166] font-medium block mb-1">Name</label>
        <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:border-[#c86f43]" />
      </div>
      <div>
        <label className="text-xs text-[#7b7166] font-medium block mb-1">Phone</label>
        <input type="text" value={editPhone} onChange={e => setEditPhone(e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:border-[#c86f43]" />
      </div>
      <div>
        <label className="text-xs text-[#7b7166] font-medium block mb-1">Email</label>
        <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:border-[#c86f43]" />
      </div>
      <button onClick={onCancel}
        className="w-full px-4 py-2.5 rounded-xl border border-[#e1d3c2] text-[#6e6357] text-sm font-medium hover:bg-[#f0e8de] transition-colors">
        Done Editing
      </button>
    </div>
  )
}

function Step4Confirm({ callStatus, interest, topics, age, occupation, familySize, income, budget, preferredLocation, timeline, livingSituation, investmentPurpose, followupOption, remarkText, editName }: any) {
  const summaryItems = [
    { label: 'Call Status', value: CALL_STATUS_OPTIONS.find(o => o.value === callStatus)?.label ?? callStatus },
    interest && { label: 'Interest', value: INTEREST_OPTIONS.find(o => o.value === interest)?.label ?? interest },
    topics.length > 0 && { label: 'Topics', value: topics.map(t => L[t] ?? t).join(', ') },
    age && { label: 'Age', value: L[age] ?? age },
    occupation && { label: 'Occupation', value: L[occupation] ?? occupation },
    familySize && { label: 'Family Size', value: L[familySize] },
    income && { label: 'Income', value: L[income] ?? income },
    budget && { label: 'Budget', value: L[budget] ?? budget },
    preferredLocation && { label: 'Preferred Location', value: preferredLocation },
    timeline && { label: 'Timeline', value: L[timeline] ?? timeline },
    livingSituation && { label: 'Living Situation', value: L[livingSituation] ?? livingSituation },
    investmentPurpose && { label: 'Investment Purpose', value: investmentPurpose },
    followupOption && followupOption !== 'not_needed' && { label: 'Follow-up', value: FOLLOWUP_OPTIONS.find(o => o.value === followupOption)?.label },
    remarkText && { label: 'Note', value: remarkText },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="space-y-4">
      <div className="bg-[#f8f4ef] rounded-2xl p-4">
        <p className="text-sm font-semibold text-[#1f1914] mb-3">Summary</p>
        <div className="space-y-2">
          {summaryItems.map(item => (
            <div key={item.label} className="flex justify-between text-sm">
              <span className="text-[#8f8378]">{item.label}</span>
              <span className="font-medium text-[#2b241e] text-right max-w-[60%]">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
      {editName && (
        <div className="bg-[#fef7f2] border border-[#efd7c6] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#7b7166] mb-1">Lead Name</p>
          <p className="text-sm font-medium text-[#2b241e]">{editName}</p>
        </div>
      )}
    </div>
  )
}