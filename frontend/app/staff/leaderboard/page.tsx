'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { analyticsApi } from '@/lib/api'
import { Role, hasRole, canAccessFeature } from '@/hooks/useRoleGuard'

interface LeaderboardEntry {
  agent_id: string
  agent_name: string
  role: Role
  star_rating: number | null
  performance_score: number
  completion_rate: number
  conversion_rate: number
  active_lead_count: number
  is_active: boolean
}

export default function LeaderboardPage() {
  const { agent } = useAuthStore()
  const router = useRouter()
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<keyof LeaderboardEntry>('performance_score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    if (!agent) {
      router.push('/login')
      return
    }

    if (!canAccessFeature(agent.role as Role, 'leaderboard')) {
      router.push('/unauthorized')
      return
    }

    fetchLeaderboard()
  }, [agent, router])

  const fetchLeaderboard = async () => {
    try {
      const data = await analyticsApi.agentLeaderboard?.() || []
      setLeaderboard(data)
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (key: keyof LeaderboardEntry) => {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
    const aVal = a[sortBy]
    const bVal = b[sortBy]

    if (aVal === null || aVal === undefined) return 1
    if (bVal === null || bVal === undefined) return -1

    const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0
    return sortDir === 'desc' ? -comparison : comparison
  })

  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-gray-400">-</span>
    return (
      <span className="text-yellow-500">
        {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
      </span>
    )
  }

  const renderScoreGauge = (score: number) => {
    const color = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600'
    return <span className={`font-semibold ${color}`}>{score.toFixed(1)}</span>
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading leaderboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <button
            onClick={() => router.push('/')}
            className="text-sm text-gray-600 hover:text-gray-900 mb-3 inline-flex items-center gap-1 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Agent Leaderboard</h1>
          <p className="text-gray-600 mt-1">Performance rankings based on star ratings and scores</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-600">Total Agents</p>
            <p className="text-2xl font-bold">{leaderboard.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-600">Avg Performance Score</p>
            <p className="text-2xl font-bold">
              {leaderboard.length > 0
                ? (leaderboard.reduce((sum, a) => sum + a.performance_score, 0) / leaderboard.length).toFixed(1)
                : '0'}
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-600">Avg Completion Rate</p>
            <p className="text-2xl font-bold">
              {leaderboard.length > 0
                ? (leaderboard.reduce((sum, a) => sum + a.completion_rate, 0) / leaderboard.length).toFixed(1)
                : '0'}%
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-600">Avg Conversion Rate</p>
            <p className="text-2xl font-bold">
              {leaderboard.length > 0
                ? (leaderboard.reduce((sum, a) => sum + a.conversion_rate, 0) / leaderboard.length).toFixed(1)
                : '0'}%
            </p>
          </div>
        </div>

        {/* Leaderboard Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('agent_name')}
                >
                  Rank | Agent
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('role')}
                >
                  Role
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('star_rating')}
                >
                  ⭐ Rating
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('performance_score')}
                >
                  Perf Score
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('completion_rate')}
                >
                  Completion %
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('conversion_rate')}
                >
                  Conversion %
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('active_lead_count')}
                >
                  Active Leads
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedLeaderboard.map((agent, index) => (
                <tr
                  key={agent.agent_id}
                  className={`hover:bg-gray-50 ${!agent.is_active ? 'bg-gray-50 opacity-60' : ''}`}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm mr-3">
                        {index + 1}
                      </span>
                      <div>
                        <button
                          onClick={() => router.push(`/staff/${agent.agent_id}`)}
                          className="font-medium text-gray-900 hover:text-blue-600 hover:underline text-left"
                        >
                          {agent.agent_name}
                        </button>
                        <p className="text-xs text-gray-500">{agent.agent_id.slice(0, 8)}...</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                      ${agent.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                        agent.role === 'manager' ? 'bg-blue-100 text-blue-800' :
                        agent.role === 'agent' ? 'bg-green-100 text-green-800' :
                        'bg-gray-100 text-gray-800'}`}>
                      {agent.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {renderStars(agent.star_rating)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {renderScoreGauge(agent.performance_score)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                        <div
                          className={`h-2 rounded-full ${
                            agent.completion_rate >= 80 ? 'bg-green-500' :
                            agent.completion_rate >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, agent.completion_rate)}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-600">{agent.completion_rate.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">{agent.conversion_rate.toFixed(1)}%</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900">{agent.active_lead_count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {leaderboard.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No agents found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
