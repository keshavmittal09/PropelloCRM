'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { leadsApi, contactsApi } from '@/lib/api'
import type { Lead } from '@/lib/types'
import toast from 'react-hot-toast'

interface Props {
  lead: Lead
  onClose: () => void
}

export function EditLeadDrawer({ lead, onClose }: Props) {
  const qc = useQueryClient()
  const contact = lead.contact
  const masterProfile = lead.master_profile || {}

  const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
  const asStringFromNumber = (value: unknown): string =>
    typeof value === 'number' ? String(value) : ''

  const [name, setName] = useState<string>(contact?.name ?? asString(masterProfile.full_name))
  const [phone, setPhone] = useState<string>(contact?.phone ?? '')
  const [email, setEmail] = useState<string>(contact?.email ?? asString(masterProfile.email))
  const [alternatePhone, setAlternatePhone] = useState<string>(asString(masterProfile.alternate_phone))
  const [propertyType, setPropertyType] = useState<string>(lead.property_type_interest ?? asString(masterProfile.config_preference))
  const [location, setLocation] = useState<string>(lead.location_preference ?? asString(masterProfile.city))
  const [locality, setLocality] = useState<string>(asString(masterProfile.locality))
  const [budgetMin, setBudgetMin] = useState(lead.budget_min?.toString() ?? '')
  const [budgetMax, setBudgetMax] = useState(lead.budget_max?.toString() ?? '')
  const [timeline, setTimeline] = useState(lead.timeline ?? '')
  const [occupation, setOccupation] = useState<string>(asString(masterProfile.occupation))
  const [familySize, setFamilySize] = useState<string>(asStringFromNumber(masterProfile.family_size))
  const [livingSituation, setLivingSituation] = useState<string>(asString(masterProfile.current_living_situation))
  const [investmentPurpose, setInvestmentPurpose] = useState<string>(asString(masterProfile.investment_purpose))
  const [source, setSource] = useState<string>(asString(masterProfile.source))
  const [notes, setNotes] = useState<string>(contact?.personal_notes ?? asString(masterProfile.agent_notes))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      // Update contact
      if (contact?.id) {
        await contactsApi.update(contact.id, {
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          personal_notes: notes.trim() || undefined,
        })
      }

      // Update lead master profile
      await leadsApi.updateMasterProfile(lead.id, {
        full_name: name.trim() || undefined,
        email: email.trim() || undefined,
        alternate_phone: alternatePhone.trim() || undefined,
        config_preference: propertyType.trim() || undefined,
        city: location.trim() || undefined,
        locality: locality.trim() || undefined,
        budget_range: budgetMin || budgetMax ? `${budgetMin || '?'}-${budgetMax || '?'}` : undefined,
        occupation: occupation.trim() || undefined,
        family_size: familySize ? parseInt(familySize) : undefined,
        current_living_situation: livingSituation.trim() || undefined,
        investment_purpose: investmentPurpose.trim() || undefined,
        source: source.trim() || undefined,
        agent_notes: notes.trim() || undefined,
      })

      // Update lead basic fields
      await leadsApi.update(lead.id, {
        property_type_interest: propertyType.trim() || undefined,
        location_preference: location.trim() || undefined,
        budget_min: budgetMin ? parseFloat(budgetMin) : undefined,
        budget_max: budgetMax ? parseFloat(budgetMax) : undefined,
        timeline: timeline.trim() || undefined,
      })

      toast.success('Lead details updated')
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      onClose()
    } catch {
      toast.error('Failed to save lead details')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-white shadow-2xl border-l border-[#e8ddcf] flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#e8ddcf] bg-gradient-to-r from-[#fefbf7] to-[#f7f0e8]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[#1f1914]">Edit Lead Details</h3>
              <p className="text-xs text-[#7b7166] mt-0.5">{contact?.name} &middot; {contact?.phone}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7b7166] hover:bg-[#f0e8de] transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
          <FieldGroup label="Full Name">
            <input value={name} onChange={e => setName(e.target.value)} className="drawer-input" />
          </FieldGroup>
          <FieldGroup label="Phone">
            <input value={phone} onChange={e => setPhone(e.target.value)} className="drawer-input" />
          </FieldGroup>
          <FieldGroup label="Email">
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="drawer-input" />
          </FieldGroup>
          <FieldGroup label="Alternate Phone">
            <input value={alternatePhone} onChange={e => setAlternatePhone(e.target.value)} className="drawer-input" />
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Budget Min (₹)">
              <input value={budgetMin} onChange={e => setBudgetMin(e.target.value)} type="number" className="drawer-input" />
            </FieldGroup>
            <FieldGroup label="Budget Max (₹)">
              <input value={budgetMax} onChange={e => setBudgetMax(e.target.value)} type="number" className="drawer-input" />
            </FieldGroup>
          </div>
          <FieldGroup label="Property Type / Config">
            <select value={propertyType} onChange={e => setPropertyType(e.target.value)} className="drawer-input bg-white">
              <option value="">Select...</option>
              <option value="1BHK">1 BHK</option>
              <option value="2BHK">2 BHK</option>
              <option value="3BHK">3 BHK</option>
              <option value="4BHK">4 BHK</option>
              <option value="Villa">Villa</option>
              <option value="Plot">Plot</option>
              <option value="Commercial">Commercial</option>
            </select>
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="City">
              <input value={location} onChange={e => setLocation(e.target.value)} className="drawer-input" />
            </FieldGroup>
            <FieldGroup label="Locality">
              <input value={locality} onChange={e => setLocality(e.target.value)} className="drawer-input" />
            </FieldGroup>
          </div>
          <FieldGroup label="Timeline">
            <select value={timeline} onChange={e => setTimeline(e.target.value)} className="drawer-input bg-white">
              <option value="">Select...</option>
              <option value="immediate">Immediate</option>
              <option value="1_month">Within 1 month</option>
              <option value="3_months">Within 3 months</option>
              <option value="6_months">Within 6 months</option>
              <option value="1_year">Within 1 year</option>
              <option value="exploring">Just exploring</option>
            </select>
          </FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Occupation">
              <select value={occupation} onChange={e => setOccupation(e.target.value)} className="drawer-input bg-white">
                <option value="">Select...</option>
                <option value="Salaried">Salaried</option>
                <option value="Business">Business</option>
                <option value="Retired">Retired</option>
                <option value="Other">Other</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Family Size">
              <input value={familySize} onChange={e => setFamilySize(e.target.value)} type="number" className="drawer-input" />
            </FieldGroup>
          </div>
          <FieldGroup label="Current Living">
            <select value={livingSituation} onChange={e => setLivingSituation(e.target.value)} className="drawer-input bg-white">
              <option value="">Select...</option>
              <option value="Renting">Renting</option>
              <option value="Owned">Owned</option>
              <option value="Other">Other</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Investment Purpose">
            <select value={investmentPurpose} onChange={e => setInvestmentPurpose(e.target.value)} className="drawer-input bg-white">
              <option value="">Select...</option>
              <option value="Self-use">Self-use</option>
              <option value="Investment">Investment</option>
              <option value="Both">Both</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Source">
            <select value={source} onChange={e => setSource(e.target.value)} className="drawer-input bg-white">
              <option value="">Select...</option>
              <option value="Expo">Expo</option>
              <option value="Online Ad">Online Ad</option>
              <option value="Referral">Referral</option>
              <option value="Cold Call">Cold Call</option>
              <option value="Campaign">Campaign</option>
              <option value="Other">Other</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Personal Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="drawer-input resize-none" />
          </FieldGroup>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e8ddcf] bg-[#faf7f3] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[#e1d3c2] text-[#6e6357] font-medium hover:bg-[#f0e8de] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#2f2317] text-white font-semibold hover:bg-[#1f1610] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .drawer-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid #e1d3c2;
          border-radius: 0.75rem;
          font-size: 0.875rem;
          color: #2b241e;
          transition: all 0.15s;
        }
        .drawer-input:focus {
          outline: none;
          border-color: #c86f43;
          box-shadow: 0 0 0 3px rgba(200, 111, 67, 0.15);
        }
      `}</style>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#7b7166] mb-1 block">{label}</label>
      {children}
    </div>
  )
}
