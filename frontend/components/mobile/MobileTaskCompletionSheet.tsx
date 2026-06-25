'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tasksApi, leadsApi } from '@/lib/api'
import type { Task, DemographicsInput, TaskCompleteDemographicPayload } from '@/lib/types'
import toast from 'react-hot-toast'

// ─── Option definitions ───────────────────────────────────────────────────────

const CALL_STATUS_OPTIONS = [
  { value: 'connected', label: 'Yes, Connected', emoji: '✅' },
  { value: 'no_answer', label: 'No Answer', emoji: '📵' },
  { value: 'wrong_number', label: 'Wrong Number', emoji: '❌' },
  { value: 'callback', label: 'Call Back Later', emoji: '🔄' },
] as const

const INTEREST_OPTIONS = [
  { value: 'hot', label: 'Hot', emoji: '🔴' },
  { value: 'warm', label: 'Warm', emoji: '🟠' },
  { value: 'cold', label: 'Cold', emoji: '🔵' },
  { value: 'not_interested', label: 'Not Interested', emoji: '🚫' },
  { value: 'busy', label: 'Busy', emoji: '🔕' },
  { value: 'unknown', label: "Don't Know", emoji: '❓' },
] as const

const TOPIC_OPTIONS = [
  { value: 'price', label: 'Price' },
  { value: 'location', label: 'Location' },
  { value: 'flat_size', label: 'Flat Size' },
  { value: 'loan', label: 'Loan' },
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'other', label: 'Other' },
] as const

const AGE_OPTIONS = ['under_20', '20-30', '30-40', '40-50', '50-60', '60+', 'unknown'] as const
const OCCUPATION_OPTIONS = [
  'salaried_private', 'salaried_government', 'self_employed',
  'professional', 'farmer', 'student', 'homemaker', 'unknown', 'other',
] as const
const FAMILY_OPTIONS = ['1-2', '3-4', '5-6', '6+', 'unknown'] as const
const INCOME_OPTIONS = ['under_20000', '20000-40000', '40000-75000', '75000-150000', '150000+', 'unknown'] as const
const BUDGET_OPTIONS = ['under_20L', '20L-40L', '40L-70L', '70L-1Cr', '1Cr-2Cr', '2Cr+', 'unknown'] as const
const TIMELINE_OPTIONS = ['immediate', 'soon', 'later', 'exploring', 'unknown'] as const

const LABEL: Record<string, string> = {
  under_20: 'Under 20', '20-30': '20–30', '30-40': '30–40', '40-50': '40–50', '50-60': '50–60', '60+': '60+', unknown: "Don't Know",
  salaried_private: 'Salaried – Private', salaried_government: 'Salaried – Govt', self_employed: 'Self-Employed',
  professional: 'Professional', farmer: 'Farmer', student: 'Student', homemaker: 'Homemaker', other: 'Other',
  '1-2': '1–2', '3-4': '3–4', '5-6': '5–6', '6+': '6+',
  under_20000: '<₹20K', '20000-40000': '₹20–40K', '40000-75000': '₹40–75K', '75000-150000': '₹75K–1.5L', '150000+': '₹1.5L+',
  under_20L: '<₹20L', '20L-40L': '₹20–40L', '40L-70L': '₹40–70L', '70L-1Cr': '₹70L–1Cr', '1Cr-2Cr': '₹1–2Cr', '2Cr+': '₹2Cr+',
  immediate: 'Immediately', soon: 'Soon (3–6m)', later: 'Later (6–12m)', exploring: 'Just Exploring',
}

const FOLLOWUP_OPTIONS = [
  { value: 'today_evening', label: 'Today Evening' },
  { value: 'tomorrow_morning', label: 'Tomorrow Morning' },
  { value: '3_days', label: 'In 3 Days' },
  { value: '1_week', label: 'In 1 Week' },
  { value: 'not_needed', label: 'Not Needed' },
]

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  task: Task
  onClose: () => void
  onComplete: () => void
}

export function MobileTaskCompletionSheet({ task, onClose, onComplete }: Props) {
  const qc = useQueryClient()
  const leadId = task.lead_id

  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  // Step 1 state
  const [callStatus, setCallStatus] = useState<string | null>(null)
  const [interest, setInterest] = useState<string | null>(null)
  const [topics, setTopics] = useState<string[]>([])

  // Step 2 state
  const [age, setAge] = useState<string | null>(null)
  const [occupation, setOccupation] = useState<string | null>(null)
  const [occupationOther, setOccupationOther] = useState('')
  const [familySize, setFamilySize] = useState<string | null>(null)
  const [income, setIncome] = useState<string | null>(null)
  const [budget, setBudget] = useState<string | null>(null)
  const [preferredLocation, setPreferredLocation] = useState('')
  const [timeline, setTimeline] = useState<string | null>(null)

  // Step 3 state
  const [followupOption, setFollowupOption] = useState<string | null>(null)
  const [followupDate, setFollowupDate] = useState<string>('')
  const [followupTime, setFollowupTime] = useState<string>('09:00')
  const [note, setNote] = useState('')

  // Load existing lead data for pre-fill
  const { data: lead } = (() => {
    // inline useLead-style query using leadsApi directly
    const [ld, setLd] = useState<any>(null)
    // We use the task's embedded lead if available
    return { data: task.lead ?? null }
  })()

  const existingDemo = task.lead ?? null

  // Pre-fill step 2 from existing lead data
  useState(() => {
    if (existingDemo) {
      setAge(existingDemo.age_range ?? null)
      setOccupation(existingDemo.occupation ?? null)
      setFamilySize(existingDemo.family_size ?? null)
      setIncome(existingDemo.income_range ?? null)
      setBudget(existingDemo.property_budget ?? null)
      setPreferredLocation(existingDemo.preferred_location ?? '')
      setTimeline(existingDemo.purchase_timeline ?? null)
    }
  })

  function toggleTopic(topic: string) {
    setTopics(prev => prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic])
  }

  function getNextFollowupDate(): string | null {
    if (followupOption === 'not_needed') return null
    const now = new Date()
    let date = new Date(now)

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
      default:
        if (followupDate) {
          const [y, m, d] = followupDate.split('-').map(Number)
          date = new Date(y, m - 1, d)
          const [h, min] = followupTime.split(':').map(Number)
          date.setHours(h, min, 0, 0)
        }
    }

    return followupOption ? date.toISOString() : null
  }

  async function handleSubmit() {
    if (!callStatus) {
      toast.error('Please select call status')
      return
    }

    setSubmitting(true)
    try {
      const demographics: DemographicsInput = {}
      if (age) demographics.age_range = age
      if (occupation) demographics.occupation = occupation
      if (occupationOther) demographics.occupation_other = occupationOther
      if (familySize) demographics.family_size = familySize
      if (income) demographics.income_range = income
      if (budget) demographics.property_budget = budget
      if (preferredLocation) demographics.preferred_location = preferredLocation
      if (timeline) demographics.purchase_timeline = timeline

      const payload: TaskCompleteDemographicPayload = {
        call_status: callStatus as TaskCompleteDemographicPayload['call_status'],
        interest_level: interest ? (interest as TaskCompleteDemographicPayload['interest_level']) : undefined,
        topics_discussed: topics,
        demographics: Object.keys(demographics).length > 0 ? demographics : undefined,
        next_followup_at: getNextFollowupDate(),
        note: note.trim() || undefined,
      }

      await tasksApi.completeWithDemographic(task.id, payload)
      toast.success('Task completed!')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      if (leadId) {
        qc.invalidateQueries({ queryKey: ['timeline', leadId] })
        qc.invalidateQueries({ queryKey: ['lead', leadId] })
        qc.invalidateQueries({ queryKey: ['master-profile', leadId] })
        qc.invalidateQueries({ queryKey: ['leads'] })
      }
      onComplete()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Failed to complete task')
    } finally {
      setSubmitting(false)
    }
  }

  const canProceedToStep2 = !!callStatus
  const canProceedToStep3 = true // step 2 is optional if connected
  const canSubmit = !!callStatus

  const profileName = typeof task.lead?.master_profile?.full_name === 'string' ? task.lead.master_profile.full_name : null
  const leadName = task.lead?.contact?.name ?? profileName ?? 'Lead'

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex flex-col justify-end">
      <div className="bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
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
              onClick={() => {
                if (step === 1) onClose()
                else setStep(s => s - 1)
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7b7166] hover:bg-[#f0e8de] transition-colors text-sm"
            >
              {step === 1 ? '✕' : '←'}
            </button>
          </div>

          {/* Progress bar */}
          <div className="flex gap-1.5 mt-3">
            {[1, 2, 3].map(s => (
              <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors ${s <= step ? 'bg-[#c86f43]' : 'bg-[#e8ddcf]'}`} />
            ))}
          </div>
          <p className="text-xs text-[#8f8378] mt-1.5">
            Step {step} of 3 — {
              step === 1 ? 'Call Details' :
              step === 2 ? 'Customer Profile' :
              'Next Steps'
            }
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {step === 1 && <Step1 callStatus={callStatus} setCallStatus={setCallStatus} interest={interest} setInterest={setInterest} topics={topics} toggleTopic={toggleTopic} />}
          {step === 2 && <Step2 age={age} setAge={setAge} occupation={occupation} setOccupation={setOccupation} occupationOther={occupationOther} setOccupationOther={setOccupationOther} familySize={familySize} setFamilySize={setFamilySize} income={income} setIncome={setIncome} budget={budget} setBudget={setBudget} preferredLocation={preferredLocation} setPreferredLocation={setPreferredLocation} timeline={timeline} setTimeline={setTimeline} />}
          {step === 3 && <Step3 followupOption={followupOption} setFollowupOption={setFollowupOption} followupDate={followupDate} setFollowupDate={setFollowupDate} followupTime={followupTime} setFollowupTime={setFollowupTime} note={note} setNote={setNote} />}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#e8ddcf] bg-[#faf7f3]">
          <div className="flex gap-3">
            {step > 1 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex-1 px-5 py-3 rounded-xl border border-[#e1d3c2] text-[#6e6357] font-medium hover:bg-[#f0e8de] transition-colors"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => {
                  if (!canProceedToStep2 && step === 1) {
                    toast.error('Select call status to continue')
                    return
                  }
                  setStep(s => s + 1)
                }}
                className="flex-1 px-5 py-3 rounded-xl bg-[#2f2317] text-white font-semibold hover:bg-[#1f1610] transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="flex-1 px-5 py-3 rounded-xl bg-[#2f7a4e] text-white font-semibold hover:bg-[#236539] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit & Complete'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Step 1 ─────────────────────────────────────────────────────────────────

function Step1({
  callStatus, setCallStatus,
  interest, setInterest,
  topics, toggleTopic,
}: {
  callStatus: string | null; setCallStatus: (v: string) => void
  interest: string | null; setInterest: (v: string) => void
  topics: string[]; toggleTopic: (v: string) => void
}) {
  const isConnected = callStatus === 'connected'

  return (
    <div className="space-y-5">
      {/* Q1: Call status */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Did you reach them?</p>
        <div className="grid grid-cols-2 gap-2">
          {CALL_STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setCallStatus(opt.value)}
              className={`py-3 px-3 rounded-xl border-2 text-sm font-medium transition-all flex items-center gap-2 ${
                callStatus === opt.value
                  ? 'border-[#c86f43] bg-[#fef7f2] text-[#c86f43]'
                  : 'border-[#e1d3c2] bg-white text-[#4f453b]'
              }`}
            >
              <span>{opt.emoji}</span> {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Q2: Interest level (only if connected) */}
      {isConnected && (
        <div>
          <p className="text-sm font-semibold text-[#1f1914] mb-2">Interest level?</p>
          <div className="grid grid-cols-2 gap-2">
            {INTEREST_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setInterest(opt.value === interest ? null : opt.value)}
                className={`py-3 px-3 rounded-xl border-2 text-sm font-medium transition-all flex items-center gap-2 ${
                  interest === opt.value
                    ? 'border-[#c86f43] bg-[#fef7f2] text-[#c86f43]'
                    : 'border-[#e1d3c2] bg-white text-[#4f453b]'
                }`}
              >
                <span>{opt.emoji}</span> {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Q3: Topics (only if connected) */}
      {isConnected && (
        <div>
          <p className="text-sm font-semibold text-[#1f1914] mb-2">What was discussed?</p>
          <div className="flex flex-wrap gap-2">
            {TOPIC_OPTIONS.map(opt => {
              const active = topics.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleTopic(opt.value)}
                  className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                    active
                      ? 'bg-[#2f2317] text-white border-[#2f2317]'
                      : 'bg-white text-[#4f453b] border-[#e1d3c2]'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 2 ─────────────────────────────────────────────────────────────────

function SelectChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
        selected
          ? 'bg-[#2f2317] text-white border-[#2f2317]'
          : 'bg-white text-[#4f453b] border-[#e1d3c2]'
      }`}
    >
      {label}
    </button>
  )
}

function Step2({
  age, setAge,
  occupation, setOccupation,
  occupationOther, setOccupationOther,
  familySize, setFamilySize,
  income, setIncome,
  budget, setBudget,
  preferredLocation, setPreferredLocation,
  timeline, setTimeline,
}: {
  age: string | null; setAge: (v: string) => void
  occupation: string | null; setOccupation: (v: string) => void
  occupationOther: string; setOccupationOther: (v: string) => void
  familySize: string | null; setFamilySize: (v: string) => void
  income: string | null; setIncome: (v: string) => void
  budget: string | null; setBudget: (v: string) => void
  preferredLocation: string; setPreferredLocation: (v: string) => void
  timeline: string | null; setTimeline: (v: string) => void
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-[#8f8378]">Fill what you learned — estimates are okay.</p>

      {/* Age */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Age range</p>
        <div className="flex flex-wrap gap-2">
          {AGE_OPTIONS.map(v => (
            <SelectChip key={v} label={LABEL[v] ?? v} selected={age === v} onClick={() => setAge(v === age ? null : v)} />
          ))}
        </div>
      </div>

      {/* Occupation */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Occupation</p>
        <div className="flex flex-wrap gap-2">
          {OCCUPATION_OPTIONS.map(v => (
            <SelectChip key={v} label={LABEL[v] ?? v} selected={occupation === v} onClick={() => setOccupation(v === occupation ? null : v)} />
          ))}
        </div>
        {occupation === 'other' && (
          <input
            type="text"
            value={occupationOther}
            onChange={e => setOccupationOther(e.target.value)}
            placeholder="Specify occupation..."
            className="mt-2 w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
          />
        )}
      </div>

      {/* Family size */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Family size</p>
        <div className="flex flex-wrap gap-2">
          {FAMILY_OPTIONS.map(v => (
            <SelectChip key={v} label={LABEL[v] ?? v} selected={familySize === v} onClick={() => setFamilySize(v === familySize ? null : v)} />
          ))}
        </div>
      </div>

      {/* Income */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Monthly income (estimate)</p>
        <div className="flex flex-wrap gap-2">
          {INCOME_OPTIONS.map(v => (
            <SelectChip key={v} label={LABEL[v] ?? v} selected={income === v} onClick={() => setIncome(v === income ? null : v)} />
          ))}
        </div>
      </div>

      {/* Budget */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Property budget</p>
        <div className="flex flex-wrap gap-2">
          {BUDGET_OPTIONS.map(v => (
            <SelectChip key={v} label={LABEL[v] ?? v} selected={budget === v} onClick={() => setBudget(v === budget ? null : v)} />
          ))}
        </div>
      </div>

      {/* Preferred location */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Preferred location</p>
        <input
          type="text"
          value={preferredLocation}
          onChange={e => setPreferredLocation(e.target.value)}
          placeholder="e.g. Noida, Sector 62"
          className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
        />
      </div>

      {/* Timeline */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">When do they need it?</p>
        <div className="flex flex-wrap gap-2">
          {TIMELINE_OPTIONS.map(v => (
            <SelectChip key={v} label={LABEL[v] ?? v} selected={timeline === v} onClick={() => setTimeline(v === timeline ? null : v)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Step 3 ─────────────────────────────────────────────────────────────────

function Step3({
  followupOption, setFollowupOption,
  followupDate, setFollowupDate,
  followupTime, setFollowupTime,
  note, setNote,
}: {
  followupOption: string | null; setFollowupOption: (v: string) => void
  followupDate: string; setFollowupDate: (v: string) => void
  followupTime: string; setFollowupTime: (v: string) => void
  note: string; setNote: (v: string) => void
}) {
  return (
    <div className="space-y-5">
      {/* Next follow-up */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Schedule next follow-up</p>
        <div className="grid grid-cols-2 gap-2">
          {FOLLOWUP_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFollowupOption(opt.value === followupOption ? null : opt.value)}
              className={`py-3 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                followupOption === opt.value
                  ? 'border-[#c86f43] bg-[#fef7f2] text-[#c86f43]'
                  : 'border-[#e1d3c2] bg-white text-[#4f453b]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Custom date/time picker */}
        {followupOption && followupOption !== 'not_needed' && (
          <div className="mt-3 flex gap-2">
            <input
              type="date"
              value={followupDate}
              onChange={e => setFollowupDate(e.target.value)}
              className="flex-1 px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
            />
            <input
              type="time"
              value={followupTime}
              onChange={e => setFollowupTime(e.target.value)}
              className="w-28 px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43]"
            />
          </div>
        )}
      </div>

      {/* Note */}
      <div>
        <p className="text-sm font-semibold text-[#1f1914] mb-2">Additional note <span className="text-[#8f8378] font-normal">(optional)</span></p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value.slice(0, 200))}
          rows={3}
          maxLength={200}
          placeholder="Anything else to remember..."
          className="w-full px-3 py-2.5 border border-[#e1d3c2] rounded-xl text-sm bg-[#fefcfa] focus:outline-none focus:ring-2 focus:ring-[#c86f43]/30 focus:border-[#c86f43] resize-none"
        />
        <p className="text-xs text-[#8f8378] text-right mt-1">{note.length}/200</p>
      </div>
    </div>
  )
}
