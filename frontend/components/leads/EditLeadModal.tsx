'use client'
import { useState } from 'react'
import { leadsApi, contactsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { Lead } from '@/lib/types'

export function EditLeadModal({ lead, onClose }: { lead: Lead, onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()

  // Contact fields
  const [name, setName] = useState(lead.contact?.name || '')
  const [phone, setPhone] = useState(lead.contact?.phone || '')
  const [personalNotes, setPersonalNotes] = useState(lead.contact?.personal_notes || '')

  // Lead fields
  const [budgetMin, setBudgetMin] = useState<number | ''>(lead.budget_min || '')
  const [budgetMax, setBudgetMax] = useState<number | ''>(lead.budget_max || '')
  const [propType, setPropType] = useState(lead.property_type_interest || '')
  const [locationPref, setLocationPref] = useState(lead.location_preference || '')
  const [timeline, setTimeline] = useState(lead.timeline || '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // 1. Update Contact level
      if (lead.contact?.id) {
        await contactsApi.update(lead.contact.id, {
          name, phone, personal_notes: personalNotes
        })
      }
      
      // 2. Update Lead level
      await leadsApi.update(lead.id, {
        budget_min: budgetMin === '' ? null : budgetMin,
        budget_max: budgetMax === '' ? null : budgetMax,
        property_type_interest: propType,
        location_preference: locationPref,
        timeline: timeline || null
      })

      toast.success('Lead details updated successfully')
      qc.invalidateQueries({ queryKey: ['lead', lead.id] })
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update details')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl p-6 my-8">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-semibold">Edit Lead Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Main Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} 
                className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} 
                className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border" />
            </div>
          </div>

          {/* Real Estate Specific */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">BHK / Property Type</label>
              <input type="text" placeholder="e.g. 3BHK Flat, Villa" value={propType} onChange={e => setPropType(e.target.value)} 
                className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location Interest</label>
              <input type="text" placeholder="e.g. Gurgaon Sector 56" value={locationPref} onChange={e => setLocationPref(e.target.value)} 
                className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget Min (₹)</label>
              <input type="number" placeholder="8000000" value={budgetMin} onChange={e => setBudgetMin(e.target.value ? Number(e.target.value) : '')} 
                className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget Max (₹)</label>
              <input type="number" placeholder="12000000" value={budgetMax} onChange={e => setBudgetMax(e.target.value ? Number(e.target.value) : '')} 
                className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border" />
            </div>
          </div>

          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">Buying Timeline</label>
             <select value={timeline} onChange={e => setTimeline(e.target.value)} className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm h-10 px-3 border">
               <option value="">Unknown</option>
               <option value="immediate">Immediate</option>
               <option value="1_month">1 Month</option>
               <option value="3_months">3 Months</option>
               <option value="6_months">6 Months</option>
               <option value="exploring">Just Exploring</option>
             </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Personal Notes & Requirements</label>
            <textarea value={personalNotes} onChange={e => setPersonalNotes(e.target.value)} rows={3} placeholder="Wife prefers ground floor, Needs school nearby..." 
              className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-3 border" />
          </div>

          <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-xl text-gray-700 bg-white hover:bg-gray-50 focus:outline-none">
              Cancel
            </button>
            <button type="submit" disabled={loading} className={`px-5 py-2 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white ${loading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}>
              {loading ? 'Saving...' : 'Save Details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
