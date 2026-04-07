'use client'
import { useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface AIAnalysis {
  score: string
  score_reasoning: string
  recommended_action: string
  priority: string
  engagement_summary: string
  risk_flags: string[]
  estimated_close_probability: number
  suggested_followup_channel: string
}

export default function AIAnalysisPanel({ leadId, initialAnalysis, token }: {
  leadId: string
  initialAnalysis?: AIAnalysis | null
  token?: string
}) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(initialAnalysis || null)
  const [loading, setLoading] = useState(false)
  const [suggestedMsg, setSuggestedMsg] = useState<string | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)

  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const runAnalysis = async () => {
    setLoading(true)
    try {
      const { data } = await axios.post(`${API}/api/ai/analyze/${leadId}`, {}, { headers })
      if (data.analysis) {
        setAnalysis(data.analysis)
        toast.success('AI analysis complete')
      } else {
        toast.error(data.reason || 'AI unavailable')
      }
    } catch {
      toast.error('Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const getFollowupMessage = async (channel: string) => {
    setMsgLoading(true)
    try {
      const { data } = await axios.post(
        `${API}/api/ai/suggest-message/${leadId}?channel=${channel}`,
        {},
        { headers }
      )
      if (data.message) {
        setSuggestedMsg(data.message)
      } else {
        toast.error(data.reason || 'Message generation failed')
      }
    } catch {
      toast.error('Failed to generate message')
    } finally {
      setMsgLoading(false)
    }
  }

  const scoreColors: Record<string, string> = {
    hot: 'bg-red-50 text-red-700 border-red-200',
    warm: 'bg-amber-50 text-amber-700 border-amber-200',
    cold: 'bg-blue-50 text-blue-700 border-blue-200',
  }

  const priorityColors: Record<string, string> = {
    high: 'bg-red-50 text-red-600',
    normal: 'bg-gray-50 text-gray-600',
    low: 'bg-green-50 text-green-600',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <h3 className="font-semibold text-[15px] text-gray-900 tracking-tight">AI Analysis</h3>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="px-4 py-1.5 bg-[#1d1d1f] text-white text-xs font-medium rounded-full hover:bg-black transition-all disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : analysis ? 'Re-analyze' : 'Run Analysis'}
        </button>
      </div>

      {!analysis && !loading && (
        <p className="text-sm text-gray-400 text-center py-6">
          Click "Run Analysis" to get AI-powered insights on this lead
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
        </div>
      )}

      {analysis && !loading && (
        <>
          {/* Score + Priority + Probability */}
          <div className="grid grid-cols-3 gap-3">
            <div className={`rounded-xl border p-3 text-center ${scoreColors[analysis.score] || 'bg-gray-50'}`}>
              <p className="text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1">Score</p>
              <p className="text-lg font-bold uppercase">{analysis.score}</p>
            </div>
            <div className={`rounded-xl border border-gray-100 p-3 text-center ${priorityColors[analysis.priority] || ''}`}>
              <p className="text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1">Priority</p>
              <p className="text-lg font-bold capitalize">{analysis.priority}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3 text-center bg-gray-50">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1">Close %</p>
              <p className="text-lg font-bold text-gray-800">{analysis.estimated_close_probability}%</p>
            </div>
          </div>

          {/* Engagement Summary */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Engagement Summary</p>
            <p className="text-sm text-gray-800 leading-relaxed">{analysis.engagement_summary}</p>
          </div>

          {/* Score Reasoning */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Score Reasoning</p>
            <p className="text-sm text-gray-700 leading-relaxed">{analysis.score_reasoning}</p>
          </div>

          {/* Recommended Action */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide mb-1">✨ Recommended Action</p>
            <p className="text-sm text-emerald-800 font-medium leading-relaxed">{analysis.recommended_action}</p>
          </div>

          {/* Risk Flags */}
          {analysis.risk_flags && analysis.risk_flags.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-2">⚠️ Risk Flags</p>
              <div className="space-y-1.5">
                {analysis.risk_flags.map((flag, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                    <span className="text-red-400 mt-0.5">•</span>
                    <span>{flag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Follow-up Message Generator */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Generate Follow-up Message</p>
            <div className="flex gap-2">
              <button
                onClick={() => getFollowupMessage('whatsapp')}
                disabled={msgLoading}
                className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-full hover:bg-green-100 transition-all disabled:opacity-50"
              >
                📱 WhatsApp
              </button>
              <button
                onClick={() => getFollowupMessage('email')}
                disabled={msgLoading}
                className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition-all disabled:opacity-50"
              >
                ✉️ Email
              </button>
              <button
                onClick={() => getFollowupMessage('call')}
                disabled={msgLoading}
                className="px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-full hover:bg-purple-100 transition-all disabled:opacity-50"
              >
                📞 Call Script
              </button>
            </div>

            {msgLoading && (
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 border border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                Generating personalized message...
              </div>
            )}

            {suggestedMsg && !msgLoading && (
              <div className="mt-3 bg-gray-50 rounded-xl p-4">
                <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{suggestedMsg}</pre>
                <button
                  onClick={() => { navigator.clipboard.writeText(suggestedMsg); toast.success('Copied!') }}
                  className="mt-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  📋 Copy to clipboard
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
