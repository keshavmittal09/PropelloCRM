'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/useAuthStore'

export default function LoginPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const setAuth = useAuthStore(s => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPw, setShowPw] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await authApi.login(email, password)
      // Drop any cached data from a previous account so agents never see each
      // other's tasks/leads.
      qc.clear()
      setAuth(data.agent, data.access_token)
      toast.success(`Welcome back, ${data.agent.name}!`)
      // Sales agents land on their Tasks page first; admins/managers on the dashboard.
      const role = data.agent.role
      if (role === 'admin' || role === 'manager' || role === 'reception') {
        router.push('/')
      } else if (role === 'call_agent') {
        router.push('/call-agent/tasks')
      } else {
        router.push('/tasks')
      }
    } catch {
      setError('Wrong email or password. Please try again.')
      toast.error('Wrong email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Propello CRM</h1>
          <p className="text-gray-500 mt-2">Real estate sales intelligence</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@propello.ai" required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required
                  className="w-full px-4 py-2.5 pr-24 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
                />
                <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                  {password && (
                    <button type="button" onClick={() => setPassword('')}
                      className="text-xs text-gray-500 hover:text-gray-800 px-1.5 py-1 rounded">
                      Clear
                    </button>
                  )}
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 px-1.5 py-1 rounded">
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Autofilled the old password? Tap <span className="font-medium">Clear</span> and type your new one.</p>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
