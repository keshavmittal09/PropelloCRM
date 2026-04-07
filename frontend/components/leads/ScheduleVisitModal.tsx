'use client'
import { useState } from 'react'
import { visitsApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import React from 'react'

interface ScheduleVisitModalProps {
  leadId: string
  onClose: () => void
}

export function ScheduleVisitModal({ leadId, onClose }: ScheduleVisitModalProps) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!date || !time) return toast.error('Please select date and time')
    
    setLoading(true)
    try {
      const scheduled_at = new Date(`${date}T${time}:00`).toISOString()
      await visitsApi.create({ lead_id: leadId, scheduled_at, notes })
      toast.success('Site Visit scheduled successfully!')
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
        qc.invalidateQueries({ queryKey: ['visits'] })
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to schedule visit')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-semibold">Schedule Site Visit</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} 
              className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm text-gray-900 h-10 px-3 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
            <input type="time" required value={time} onChange={e => setTime(e.target.value)} 
              className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm text-gray-900 h-10 px-3 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Bring brochures..." 
              className="w-full rounded-xl border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm text-gray-900 p-3 border" />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-xl text-gray-700 bg-white hover:bg-gray-50 focus:outline-none">
              Cancel
            </button>
            <button type="submit" disabled={loading} className={`px-4 py-2 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white ${loading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}>
              {loading ? 'Scheduling...' : 'Confirm Visit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
