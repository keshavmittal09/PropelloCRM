'use client'
import { useState } from 'react'
import toast from 'react-hot-toast'

interface Props {
  onClose: () => void
  initialName?: string
  initialPhone?: string
}

export default function TalkToAIModal({ onClose, initialName = '', initialPhone = '' }: Props) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [calling, setCalling] = useState(false)

  const triggerCall = async () => {
    if (!phone.trim()) return toast.error('Enter a phone number')
    setCalling(true)
    try {
      const res = await fetch('/api/trigger-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      })
      const raw = await res.text()
      let json: any
      try { json = JSON.parse(raw) } catch { throw new Error(res.ok ? 'Server error' : `HTTP ${res.status}`) }
      if (res.ok && json.success) {
        toast.success(`📞 Calling ${json.contact_number}…`)
        onClose()
      } else {
        toast.error(json.error || 'Call failed')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not start the call')
    } finally {
      setCalling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="text-center text-3xl font-extrabold tracking-tight bg-gradient-to-r from-pink-500 to-indigo-500 bg-clip-text text-transparent">
          Talk to Our AI
        </h2>
        <p className="mt-2 text-center text-sm text-gray-500">
          Enter the details and our AI will call instantly
        </p>

        <div className="mt-7 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Your Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone Number</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') triggerCall() }}
              placeholder="+91 98765 43210"
              inputMode="tel"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Our AI speaks in English, Hindi, and Hinglish
        </p>

        <button
          onClick={triggerCall}
          disabled={calling}
          className="mt-5 w-full rounded-full bg-gradient-to-r from-pink-500 to-indigo-500 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-lg transition-opacity hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {calling ? 'Starting call…' : 'Call Me Now'}
        </button>
      </div>
    </div>
  )
}
