'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { authApi } from '@/lib/api'
import { AgentPerformanceResponse } from '@/lib/types'

export default function AgentProfilePage() {
  const { id } = useParams()
  const { agent } = useAuthStore()
  const router = useRouter()
  const [performance, setPerformance] = useState<AgentPerformanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [starRating, setStarRating] = useState<number>(0)
  const [savingRating, setSavingRating] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'performance'>('overview')

  const agentId = typeof id === 'string' ? id : agent?.id

  useEffect(() => {
    if (!agent) {
      router.push('/login')
      return
    }

    // Check permissions
    if (agent.role !== 'admin' && agent.role !== 'manager' && agent.id !== agentId) {
      router.push('/unauthorized')
      return
    }

    fetchPerformance()
  }, [agentId, agent])

  const fetchPerformance = async () => {
    try {
      const data = await authApi.getAgentPerformance(agentId!)
      setPerformance(data)
      setStarRating(data.star_rating || 0)
    } catch (error) {
      console.error('Failed to fetch performance:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveRating = async () => {
    if (!agentId || starRating === 0) return

    setSavingRating(true)
    try {
      await authApi.setAgentRating(agentId, starRating)
      fetchPerformance()
    } catch (error) {
      console.error('Failed to save rating:', error)
    } finally {
      setSavingRating(false)
    }
  }

  const canRate = agent?.role === 'admin' || agent?.role === 'manager'
  const isOwnProfile = agent?.id === agentId

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading profile...</p>
        </div>
      </div>
    )
  }

  if (!performance) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Failed to load agent profile</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{performance.agent_name}</h1>
              <p className="text-gray-600 capitalize">{performance.role}</p>
            </div>
            {canRate && !isOwnProfile && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-gray-600">Set Rating</p>
                  <p className="text-xs text-gray-400">
                    {performance.rating_set_by_name
                      ? `By ${performance.rating_set_by_name} on ${new Date(performance.rating_set_at!).toLocaleDateString()}`
                      : 'Not rated yet'}
                  </p>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setStarRating(star)}
                      className={`text-2xl transition-colors ${
                        star <= starRating ? 'text-yellow-500' : 'text-gray-300'
                      } hover:scale-110`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleSaveRating}
                  disabled={savingRating || starRating === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {savingRating ? 'Saving...' : 'Save Rating'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex gap-4 border-b">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'performance'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Performance
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Star Rating"
              value={
                <div className="flex items-center gap-1">
                  <span className="text-2xl font-bold text-yellow-500">
                    {performance.star_rating || '-'}
                  </span>
                  {performance.star_rating && (
                    <span className="text-yellow-500">★</span>
                  )}
                </div>
              }
            />
            <StatCard
              label="Performance Score"
              value={
                <span className={`text-2xl font-bold ${
                  performance.performance_score >= 80 ? 'text-green-600' :
                  performance.performance_score >= 60 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {performance.performance_score.toFixed(1)}
                </span>
              }
            />
            <StatCard
              label="Tasks Completed (30d)"
              value={<span className="text-2xl font-bold">{performance.tasks_completed_30d}</span>}
            />
            <StatCard
              label="Leads Converted (30d)"
              value={<span className="text-2xl font-bold">{performance.leads_converted_30d}</span>}
            />
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="space-y-6">
            {/* Performance Score Gauge */}
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Score</h3>
              <div className="flex items-center gap-6">
                <div className="relative w-32 h-32">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#e5e7eb"
                      strokeWidth="16"
                      fill="none"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke={
                        performance.performance_score >= 80 ? '#16a34a' :
                        performance.performance_score >= 60 ? '#ca8a04' : '#dc2626'
                      }
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${(performance.performance_score / 100) * 352} 352`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-gray-900">
                      {performance.performance_score.toFixed(0)}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600 w-32">Completion Rate</span>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${Math.min(100, performance.completion_rate)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{performance.completion_rate.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600 w-32">Conversion Rate</span>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-600 rounded-full"
                        style={{ width: `${Math.min(100, performance.conversion_rate)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{performance.conversion_rate.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600 w-32">Avg Remark Quality</span>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-600 rounded-full"
                        style={{ width: `${(performance.avg_remark_quality / 10) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{performance.avg_remark_quality.toFixed(1)}/10</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Trend Chart */}
            {performance.trend_data && performance.trend_data.length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">14-Day Trend</h3>
                <div className="h-32 flex items-end gap-2">
                  {performance.trend_data.map((day, index) => (
                    <div
                      key={day.date}
                      className="flex-1 bg-blue-100 rounded-t hover:bg-blue-200 transition-colors relative group"
                      style={{ height: `${(day.performance_score / 100) * 100}%` }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group:block bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                        {day.performance_score.toFixed(1)} - {new Date(day.date).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-500">
                  <span>{performance.trend_data[0] && new Date(performance.trend_data[0].date).toLocaleDateString()}</span>
                  <span>{performance.trend_data[performance.trend_data.length - 1] && new Date(performance.trend_data[performance.trend_data.length - 1].date).toLocaleDateString()}</span>
                </div>
              </div>
            )}

            {/* Rating History */}
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Rating History</h3>
              {performance.rating_set_at ? (
                <div className="flex items-center gap-4">
                  <div className="flex text-yellow-500">
                    {'★'.repeat(performance.star_rating || 0)}
                    {'☆'.repeat(5 - (performance.star_rating || 0))}
                  </div>
                  <span className="text-gray-600">
                    Set by <strong>{performance.rating_set_by_name || 'Unknown'}</strong> on{' '}
                    {new Date(performance.rating_set_at).toLocaleDateString()}
                  </span>
                </div>
              ) : (
                <p className="text-gray-500">No rating set yet</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <p className="text-sm text-gray-600 mb-2">{label}</p>
      <div>{value}</div>
    </div>
  )
}
