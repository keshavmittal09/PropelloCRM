'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import Sidebar from '@/components/shared/Sidebar'
import { authApi, campaignDashboardApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import type {
  Agent,
  CampaignDashboardAnalytics,
  CampaignDashboardBatch,
  CampaignDashboardFlag,
  CampaignDashboardLead,
  CampaignDashboardLeadDetails,
  CampaignDashboardProgress,
  CampaignDashboardResults,
} from '@/lib/types'
import { useAuthStore } from '@/store/useAuthStore'

type TabKey = 'overview' | 'queue' | 'insights' | 'assignment' | 'copilot' | 'actions'

type FilterKey = 'ALL' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'RETRY' | 'DNC'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ActionForm = {
  assigned_agent: string
  action_taken: string
  notes: string
  callback_script: string
  whatsapp_sent: boolean
  dnd_flag: boolean
}

type LeadAssignment = {
  leadId: string
  leadName: string
  tier: string
  agentName: string
}

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Campaign Overview' },
  { key: 'queue', label: 'Priority Queue' },
  { key: 'insights', label: 'Insights and Playbook' },
  { key: 'assignment', label: 'Agent Assignment' },
  { key: 'copilot', label: 'AI Copilot' },
  { key: 'actions', label: 'Action Center' },
]

const filters: FilterKey[] = ['ALL', 'P1', 'P2', 'P3', 'P4', 'P5', 'RETRY', 'DNC']

const tierRank: Record<string, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5,
}

const tierClasses: Record<string, string> = {
  P1: 'bg-red-50 text-red-700 border-red-200',
  P2: 'bg-orange-50 text-orange-700 border-orange-200',
  P3: 'bg-amber-50 text-amber-700 border-amber-200',
  P4: 'bg-blue-50 text-blue-700 border-blue-200',
  P5: 'bg-slate-50 text-slate-700 border-slate-200',
}

const chartColors = ['#d76535', '#ef9f6a', '#e9b949', '#8ebd5b', '#5f88d6', '#a38bc5', '#8f8f8f']

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function pct(value: number, total: number): string {
  if (!total) return '0%'
  return `${((value / total) * 100).toFixed(1)}%`
}

function tierLabel(tier: string | null | undefined): string {
  const key = (tier || 'P5').toUpperCase()
  return tierClasses[key] ? key : 'P5'
}

function Badge({ tier }: { tier: string | null | undefined }) {
  const key = tierLabel(tier)
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', tierClasses[key])}>
      {key}
    </span>
  )
}

function MetricCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'accent'
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        tone === 'accent'
          ? 'border-[#3e342a] bg-[#2a231d] text-white'
          : 'border-[#e7dbca] bg-white text-[#2a231d]',
      )}
    >
      <p className={cn('text-[10px] font-semibold uppercase tracking-[0.16em]', tone === 'accent' ? 'text-[#c7b8aa]' : 'text-[#8b7863]')}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className={cn('mt-1 text-xs', tone === 'accent' ? 'text-[#c7b8aa]' : 'text-[#8b7863]')}>{sub}</p> : null}
    </div>
  )
}

export default function UnifiedCampaignDashboard() {
  const currentAgent = useAuthStore((s) => s.agent)

  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [batches, setBatches] = useState<CampaignDashboardBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState('')

  const [results, setResults] = useState<CampaignDashboardResults | null>(null)
  const [allLeads, setAllLeads] = useState<CampaignDashboardLead[]>([])
  const [analytics, setAnalytics] = useState<CampaignDashboardAnalytics | null>(null)
  const [flags, setFlags] = useState<CampaignDashboardFlag[]>([])
  const [progress, setProgress] = useState<CampaignDashboardProgress | null>(null)

  const [loading, setLoading] = useState(false)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [campaignName, setCampaignName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const [queueFilter, setQueueFilter] = useState<FilterKey>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [queuePage, setQueuePage] = useState(1)

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [leadDetails, setLeadDetails] = useState<CampaignDashboardLeadDetails | null>(null)
  const [leadDrawerOpen, setLeadDrawerOpen] = useState(false)
  const [leadLoading, setLeadLoading] = useState(false)

  const [actionSaving, setActionSaving] = useState(false)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [removingBatchId, setRemovingBatchId] = useState<string | null>(null)

  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAssignmentAgentIds, setSelectedAssignmentAgentIds] = useState<string[]>([])

  const [selectedInsightCategory, setSelectedInsightCategory] = useState('all')

  const [actionForm, setActionForm] = useState<ActionForm>({
    assigned_agent: '',
    action_taken: '',
    notes: '',
    callback_script: '',
    whatsapp_sent: false,
    dnd_flag: false,
  })

  const streamAbortRef = useRef<AbortController | null>(null)

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || null,
    [batches, selectedBatchId],
  )

  const canManageBatches = useMemo(
    () => ['admin', 'manager'].includes(String(currentAgent?.role || '')),
    [currentAgent?.role],
  )

  const insightRoot = useMemo(
    () => (results?.batch?.insights || analytics?.insights || {}) as Record<string, unknown>,
    [results?.batch?.insights, analytics?.insights],
  )

  const topInsights = useMemo(() => {
    if (!Array.isArray(insightRoot.top_insights)) return []
    return insightRoot.top_insights as Array<Record<string, unknown>>
  }, [insightRoot])

  const insightCategories = useMemo(() => {
    const values = topInsights.map((insight) => String(insight.category || 'general'))
    return ['all', ...Array.from(new Set(values))]
  }, [topInsights])

  const filteredInsights = useMemo(() => {
    if (selectedInsightCategory === 'all') return topInsights
    return topInsights.filter((insight) => String(insight.category || 'general') === selectedInsightCategory)
  }, [topInsights, selectedInsightCategory])

  const threeThingsToday = useMemo(() => {
    if (!Array.isArray(insightRoot.three_things_today)) return []
    return insightRoot.three_things_today.map((v) => String(v)).filter(Boolean)
  }, [insightRoot])

  const nextCampaignChanges = useMemo(() => {
    if (!Array.isArray(insightRoot.next_campaign_changes)) return []
    return insightRoot.next_campaign_changes.map((v) => String(v)).filter(Boolean)
  }, [insightRoot])

  const scriptIssueRows = useMemo(() => {
    const grouped: Record<string, number> = {}
    allLeads.forEach((lead) => {
      if (lead.script_issue_detected) {
        grouped[lead.script_issue_detected] = (grouped[lead.script_issue_detected] || 0) + 1
      }
    })
    return Object.entries(grouped)
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count)
  }, [allLeads])

  const criticalActions = useMemo(() => {
    const fromInsights = filteredInsights
      .filter((i) => ['high', 'critical'].includes(String(i.impact || '').toLowerCase()) || String(i.priority || '').toLowerCase() === 'immediate')
      .slice(0, 4)
      .map((i) => ({
        title: String(i.title || 'Action'),
        detail: String(i.action || i.finding || 'Follow up required'),
        level: String(i.impact || 'medium').toLowerCase(),
      }))

    if (fromInsights.length > 0) return fromInsights

    return flags.slice(0, 4).map((flag) => ({
      title: flag.flag_type,
      detail: flag.description,
      level: 'high',
    }))
  }, [filteredInsights, flags])

  const retryLeadCount = useMemo(
    () =>
      allLeads.filter((lead) => {
        const evalTag = String(lead.call_eval_tag || '').toLowerCase()
        const dropReason = String(lead.drop_reason || '').toLowerCase()
        const recommendedAction = String(lead.recommended_action || '').toLowerCase()

        const notConnected = evalTag !== 'yes'
        const retryReason = ['no_pickup', 'unreachable', 'scheduling_conflict', 'audio_failure'].includes(dropReason)
        const retryAction = recommendedAction.startsWith('retry') || recommendedAction === 'schedule_callback'

        return notConnected || retryReason || retryAction
      }).length,
    [allLeads],
  )

  const queueFilteredLeads = useMemo(() => {
    const search = searchQuery.trim().toLowerCase()

    return allLeads.filter((lead) => {
      const evalTag = String(lead.call_eval_tag || '').toLowerCase()
      const dropReason = String(lead.drop_reason || '').toLowerCase()
      const recommendedAction = String(lead.recommended_action || '').toLowerCase()
      const isRetryLead =
        evalTag !== 'yes'
        || ['no_pickup', 'unreachable', 'scheduling_conflict', 'audio_failure'].includes(dropReason)
        || recommendedAction.startsWith('retry')
        || recommendedAction === 'schedule_callback'

      const matchesFilter =
        queueFilter === 'ALL'
          ? true
          : queueFilter === 'RETRY'
            ? isRetryLead
          : queueFilter === 'DNC'
            ? Boolean(lead.dnd_flag)
            : tierLabel(lead.priority_tier) === queueFilter

      if (!matchesFilter) return false

      if (!search) return true

      const hay = [
        lead.name || '',
        String(lead.phone_number || ''),
        lead.drop_reason || '',
        lead.recommended_action || '',
        lead.intent_level || '',
      ]
        .join(' ')
        .toLowerCase()

      return hay.includes(search)
    })
  }, [allLeads, queueFilter, searchQuery])

  const queuePageSize = 25
  const totalQueuePages = Math.max(1, Math.ceil(queueFilteredLeads.length / queuePageSize))

  const queuePageLeads = useMemo(() => {
    const start = (queuePage - 1) * queuePageSize
    return queueFilteredLeads.slice(start, start + queuePageSize)
  }, [queueFilteredLeads, queuePage])

  const selectedLead = useMemo(() => {
    if (!selectedLeadId) return null
    return allLeads.find((lead) => lead.id === selectedLeadId) || null
  }, [allLeads, selectedLeadId])

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.is_active),
    [agents],
  )

  const assignableAgents = useMemo(() => {
    if (selectedAssignmentAgentIds.length > 0) {
      const selected = new Set(selectedAssignmentAgentIds)
      return activeAgents.filter((agent) => selected.has(agent.id))
    }
    return activeAgents.filter((agent) => agent.role === 'call_agent')
  }, [activeAgents, selectedAssignmentAgentIds])

  const suggestedAssignments = useMemo<LeadAssignment[]>(() => {
    if (assignableAgents.length === 0) return []

    const sorted = [...allLeads]
      .filter((lead) => !lead.dnd_flag)
      .sort((a, b) => {
        const tierCompare = (tierRank[tierLabel(a.priority_tier)] || 99) - (tierRank[tierLabel(b.priority_tier)] || 99)
        if (tierCompare !== 0) return tierCompare
        return String(a.id || '').localeCompare(String(b.id || ''))
      })

    const leadSplitIndex = Math.ceil(sorted.length / 2)
    const highPriorityLeads = sorted.slice(0, leadSplitIndex)
    const lowPriorityLeads = sorted.slice(leadSplitIndex)

    const agentSplitIndex = Math.ceil(assignableAgents.length / 2)
    const highPriorityAgents = assignableAgents.slice(0, agentSplitIndex)
    const lowPriorityAgents = assignableAgents.slice(agentSplitIndex)

    const topAgentPool = highPriorityAgents.length > 0 ? highPriorityAgents : assignableAgents
    const lowerAgentPool = lowPriorityAgents.length > 0 ? lowPriorityAgents : topAgentPool

    const mapped: LeadAssignment[] = []

    highPriorityLeads.forEach((lead, index) => {
      const agent = topAgentPool[index % topAgentPool.length]
      mapped.push({
        leadId: lead.id,
        leadName: lead.name || 'Unnamed',
        tier: tierLabel(lead.priority_tier),
        agentName: agent.name,
      })
    })

    lowPriorityLeads.forEach((lead, index) => {
      const agent = lowerAgentPool[index % lowerAgentPool.length]
      mapped.push({
        leadId: lead.id,
        leadName: lead.name || 'Unnamed',
        tier: tierLabel(lead.priority_tier),
        agentName: agent.name,
      })
    })

    return mapped
  }, [allLeads, assignableAgents])

  const assignmentBoard = useMemo(() => {
    const grouped: Record<string, LeadAssignment[]> = {}
    suggestedAssignments.forEach((item) => {
      if (!grouped[item.agentName]) grouped[item.agentName] = []
      grouped[item.agentName].push(item)
    })
    return grouped
  }, [suggestedAssignments])

  const derivedMetrics = useMemo(() => {
    const total = allLeads.length
    const connected = allLeads.filter((lead) => String(lead.call_eval_tag || '').toLowerCase() === 'yes').length
    const noConnect = Math.max(0, total - connected)
    const pitchReached = allLeads.filter((lead) => Boolean(lead.pitch_reached)).length
    const engaged = allLeads.filter((lead) => ['deep', 'surface'].includes(String(lead.engagement_quality || '').toLowerCase())).length
    const interestShown = allLeads.filter((lead) => ['hot', 'warm'].includes(String(lead.intent_level || '').toLowerCase())).length
    const siteCommit = allLeads.filter((lead) => Boolean(lead.site_visit_committed)).length
    const hotLeads = allLeads.filter((lead) => tierLabel(lead.priority_tier) === 'P1').length
    const dncRisk = allLeads.filter((lead) => lead.dnd_flag || String(lead.drop_reason || '').toLowerCase() === 'explicit_refusal').length

    let clarity = 0
    let professionalism = 0
    let problemResolution = 0
    let overall = 0
    let qualityCount = 0

    const qualityBuckets = {
      '0-3': 0,
      '4-6': 0,
      '7-8': 0,
      '9-10': 0,
    }

    allLeads.forEach((lead) => {
      const q = (lead.call_conversation_quality || {}) as Record<string, unknown>
      const c = toNumber(q.clarity)
      const p = toNumber(q.professionalism)
      const pr = toNumber(q.problem_resolution)
      const o = toNumber(q.overall_quality)

      if (c || p || pr || o) {
        clarity += c
        professionalism += p
        problemResolution += pr
        overall += o
        qualityCount += 1

        if (o <= 3) qualityBuckets['0-3'] += 1
        else if (o <= 6) qualityBuckets['4-6'] += 1
        else if (o <= 8) qualityBuckets['7-8'] += 1
        else qualityBuckets['9-10'] += 1
      }
    })

    const avgQuality = qualityCount
      ? {
          clarity: Number((clarity / qualityCount).toFixed(1)),
          professionalism: Number((professionalism / qualityCount).toFixed(1)),
          problemResolution: Number((problemResolution / qualityCount).toFixed(1)),
          overall: Number((overall / qualityCount).toFixed(1)),
        }
      : { clarity: 0, professionalism: 0, problemResolution: 0, overall: 0 }

    return {
      total,
      connected,
      noConnect,
      pitchReached,
      engaged,
      interestShown,
      siteCommit,
      hotLeads,
      dncRisk,
      avgQuality,
      qualityBuckets,
    }
  }, [allLeads])

  const funnelRows = useMemo(() => {
    const total = derivedMetrics.total
    return [
      { stage: 'Dialed', count: total },
      { stage: 'Connected', count: derivedMetrics.connected },
      { stage: 'Pitch delivered', count: derivedMetrics.pitchReached },
      { stage: 'Engaged', count: derivedMetrics.engaged },
      { stage: 'Interest shown', count: derivedMetrics.interestShown },
      { stage: 'Site visit commit', count: derivedMetrics.siteCommit },
    ]
  }, [derivedMetrics])

  const outcomePieData = useMemo(() => {
    const grouped: Record<string, number> = {}

    allLeads.forEach((lead) => {
      const key = (lead.drop_reason || (String(lead.call_eval_tag || '').toLowerCase() === 'yes' ? 'connected' : 'no_connect')).replace(/_/g, ' ')
      grouped[key] = (grouped[key] || 0) + 1
    })

    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7)
  }, [allLeads])

  const qualityBarData = useMemo(
    () => [
      { name: 'Professionalism', value: derivedMetrics.avgQuality.professionalism },
      { name: 'Clarity', value: derivedMetrics.avgQuality.clarity },
      { name: 'Overall', value: derivedMetrics.avgQuality.overall },
      { name: 'Problem Resolution', value: derivedMetrics.avgQuality.problemResolution },
    ],
    [derivedMetrics.avgQuality],
  )

  const qualityDistributionData = useMemo(
    () => [
      { bucket: '0-3', count: derivedMetrics.qualityBuckets['0-3'] },
      { bucket: '4-6', count: derivedMetrics.qualityBuckets['4-6'] },
      { bucket: '7-8', count: derivedMetrics.qualityBuckets['7-8'] },
      { bucket: '9-10', count: derivedMetrics.qualityBuckets['9-10'] },
    ],
    [derivedMetrics.qualityBuckets],
  )

  const hourlyData = useMemo(() => {
    const byHour = analytics?.distribution?.by_hour || {}
    return Object.keys(byHour)
      .sort((a, b) => a.localeCompare(b))
      .map((hour) => ({ hour, count: byHour[hour] }))
  }, [analytics?.distribution?.by_hour])

  const loadBatches = async () => {
    setLoadingBatches(true)
    try {
      const data = await campaignDashboardApi.getBatches(50)
      setBatches(data.items || [])
      if (!selectedBatchId && data.items.length > 0) {
        setSelectedBatchId(data.items[0].id)
      }
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to load campaign batches'
      setError(message)
    } finally {
      setLoadingBatches(false)
    }
  }

  const loadBatchData = async (batchId: string) => {
    if (!batchId) return

    setLoading(true)
    setError(null)

    try {
      const [statusRes, resultRes, flagsRes, analyticsRes] = await Promise.all([
        campaignDashboardApi.getStatus(batchId),
        campaignDashboardApi.getResults(batchId, { page: 1, limit: 1000 }),
        campaignDashboardApi.redFlags(batchId, true),
        campaignDashboardApi.analytics(batchId),
      ])

      const sortedLeads = [...(resultRes.leads || [])].sort((a, b) => {
        const tierCompare = (tierRank[tierLabel(a.priority_tier)] || 99) - (tierRank[tierLabel(b.priority_tier)] || 99)
        if (tierCompare !== 0) return tierCompare
        return (b.lead_score || 0) - (a.lead_score || 0)
      })

      setProgress(statusRes.progress)
      setResults(resultRes)
      setAllLeads(sortedLeads)
      setFlags(flagsRes.flags || [])
      setAnalytics(analyticsRes)

      if (!selectedLeadId && sortedLeads.length > 0) {
        setSelectedLeadId(sortedLeads[0].id)
      }
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to load campaign dashboard data'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const openLead = async (leadId: string) => {
    setSelectedLeadId(leadId)
    setLeadDrawerOpen(true)
    setLeadLoading(true)

    try {
      const detail = await campaignDashboardApi.getLeadDetails(leadId)
      setLeadDetails(detail)

      const lead = detail.lead
      setActionForm({
        assigned_agent: String(lead.assigned_agent ?? ''),
        action_taken: String(lead.action_taken ?? ''),
        notes: String(lead.notes ?? ''),
        callback_script: String(lead.callback_script ?? ''),
        whatsapp_sent: Boolean(lead.whatsapp_sent),
        dnd_flag: Boolean(lead.dnd_flag),
      })
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to load lead details'
      setError(message)
    } finally {
      setLeadLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      setError('Please select a call sheet file')
      return
    }
    if (!campaignName.trim()) {
      setError('Please enter a campaign name')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const res = await campaignDashboardApi.uploadCallSheet(uploadFile, campaignName.trim())
      setCampaignName('')
      setUploadFile(null)
      setSelectedBatchId(res.batch_id)
      setQueueFilter('ALL')
      setSearchQuery('')
      setQueuePage(1)
      toast.success('Campaign uploaded. AI analysis started.')
      await loadBatches()
      await loadBatchData(res.batch_id)
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Upload failed'
      setError(message)
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveBatch = async (batchId: string, batchName: string) => {
    if (!canManageBatches || removingBatchId) return

    const confirmed = typeof window === 'undefined'
      ? false
      : window.confirm(`Remove campaign batch \"${batchName}\"? This will permanently delete leads, flags, and AI analysis for this batch.`)

    if (!confirmed) return

    setRemovingBatchId(batchId)
    setError(null)

    try {
      await campaignDashboardApi.deleteBatch(batchId)

      const nextBatches = batches.filter((b) => b.id !== batchId)
      setBatches(nextBatches)

      if (selectedBatchId === batchId) {
        const fallbackBatchId = nextBatches[0]?.id || ''
        setSelectedBatchId(fallbackBatchId)
        if (!fallbackBatchId) {
          setResults(null)
          setAllLeads([])
          setAnalytics(null)
          setFlags([])
          setProgress(null)
          setSelectedLeadId(null)
          setLeadDetails(null)
          setLeadDrawerOpen(false)
        }
      }

      toast.success('Campaign batch removed')
      await loadBatches()
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to remove campaign batch'
      setError(message)
    } finally {
      setRemovingBatchId(null)
    }
  }

  const handleTriggerWorkflow = async () => {
    if (!selectedBatchId) return

    setWorkflowLoading(true)
    try {
      const res = await campaignDashboardApi.triggerWorkflow(selectedBatchId)
      toast.success(`Workflow triggered. ${res.leads_sent} leads sent.`)
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to trigger workflow'
      setError(message)
    } finally {
      setWorkflowLoading(false)
    }
  }

  const handleSendChat = async () => {
    if (!selectedBatchId || !chatInput.trim() || chatBusy) return

    const userMessage: ChatMessage = { role: 'user', content: chatInput.trim() }
    const nextHistory = [...chatHistory, userMessage]
    setChatHistory(nextHistory)
    setChatInput('')
    setChatBusy(true)

    try {
      const res = await campaignDashboardApi.campaignChat(
        selectedBatchId,
        userMessage.content,
        nextHistory,
      )
      setChatHistory((prev) => [...prev, { role: 'assistant', content: res.answer }])
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'AI chat failed'
      setChatHistory((prev) => [...prev, { role: 'assistant', content: message }])
    } finally {
      setChatBusy(false)
    }
  }

  const handleSaveAction = async () => {
    if (!selectedLeadId) return

    setActionSaving(true)
    try {
      await campaignDashboardApi.updateLeadAction(selectedLeadId, {
        assigned_agent: actionForm.assigned_agent || null,
        action_taken: actionForm.action_taken || null,
        notes: actionForm.notes || null,
        callback_script: actionForm.callback_script || null,
        whatsapp_sent: actionForm.whatsapp_sent,
        dnd_flag: actionForm.dnd_flag,
      })

      toast.success('Lead action updated')
      await openLead(selectedLeadId)
      if (selectedBatchId) {
        await loadBatchData(selectedBatchId)
      }
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to save lead action'
      setError(message)
    } finally {
      setActionSaving(false)
    }
  }

  const handleGenerateScript = async () => {
    if (!selectedLeadId) return

    setScriptLoading(true)
    try {
      const res = await campaignDashboardApi.callbackScript(selectedLeadId, true)
      setActionForm((prev) => ({ ...prev, callback_script: res.callback_script }))
      toast.success('Callback script generated')
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to generate callback script'
      setError(message)
    } finally {
      setScriptLoading(false)
    }
  }

  const handleResolveFlag = async (flagId: string) => {
    try {
      await campaignDashboardApi.resolveFlag(flagId, true)
      setFlags((prev) => prev.filter((flag) => flag.id !== flagId))
      toast.success('Flag resolved')
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to resolve flag'
      setError(message)
    }
  }

  const exportQueueCsv = () => {
    const rows = queueFilteredLeads.map((lead) => {
      const callbackWindow = lead.callback_urgency_hours ? `${lead.callback_urgency_hours}h` : ''
      return [
        tierLabel(lead.priority_tier),
        lead.name || '',
        String(lead.phone_number || ''),
        lead.intent_level || '',
        lead.drop_reason || '',
        lead.recommended_action || '',
        callbackWindow,
        lead.dnd_flag ? 'yes' : 'no',
        lead.assigned_agent || '',
      ]
    })

    const header = ['Priority', 'Lead Name', 'Phone', 'Intent', 'Drop Reason', 'Recommended Action', 'Callback Window', 'DND', 'Assigned Agent']
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedBatch?.name || 'campaign'}-priority-queue.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleAssignmentAgent = (agentId: string) => {
    if (selectedAssignmentAgentIds.includes(agentId)) {
      setSelectedAssignmentAgentIds((prev) => prev.filter((id) => id !== agentId))
      return
    }
    setSelectedAssignmentAgentIds((prev) => [...prev, agentId])
  }

  const useDefaultCallAgentPool = () => {
    setSelectedAssignmentAgentIds(
      activeAgents.filter((agent) => agent.role === 'call_agent').map((agent) => agent.id),
    )
  }

  const clearAssignmentSelection = () => {
    setSelectedAssignmentAgentIds([])
  }

  const applyAutoAssignment = async () => {
    if (suggestedAssignments.length === 0) {
      toast.error('No assignments to apply')
      return
    }

    setAssigning(true)
    try {
      const chunkSize = 8
      for (let i = 0; i < suggestedAssignments.length; i += chunkSize) {
        const chunk = suggestedAssignments.slice(i, i + chunkSize)
        await Promise.all(
          chunk.map((item) =>
            campaignDashboardApi.updateLeadAction(item.leadId, {
              assigned_agent: item.agentName,
              action_taken: 'auto_assigned',
            }),
          ),
        )
      }

      toast.success(`Auto-assigned ${suggestedAssignments.length} leads`) 
      if (selectedBatchId) {
        await loadBatchData(selectedBatchId)
      }
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Auto-assignment failed'
      setError(message)
    } finally {
      setAssigning(false)
    }
  }

  useEffect(() => {
    void loadBatches()
    authApi
      .listAgents()
      .then((data) => {
        const list = data || []
        setAgents(list)
        setSelectedAssignmentAgentIds(
          list.filter((agent) => agent.is_active && agent.role === 'call_agent').map((agent) => agent.id),
        )
      })
      .catch(() => {
        setAgents([])
        setSelectedAssignmentAgentIds([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedBatchId) return
    void loadBatchData(selectedBatchId)
    setQueuePage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId])

  useEffect(() => {
    setQueuePage(1)
  }, [queueFilter, searchQuery])

  useEffect(() => {
    if (!selectedBatchId) return
    if ((results?.batch.analysis_status || progress?.status) !== 'processing') return

    const token = typeof window !== 'undefined' ? localStorage.getItem('propello_token') : null
    if (!token) return

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const controller = new AbortController()
    streamAbortRef.current = controller

    const readSse = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/campaign/campaign-progress/${selectedBatchId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        })

        if (!response.ok || !response.body) return

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''

          for (const chunk of chunks) {
            const line = chunk.split('\n').find((part) => part.startsWith('data:'))
            if (!line) continue

            const raw = line.replace(/^data:\s*/, '').trim()
            if (!raw) continue

            try {
              const parsed = JSON.parse(raw) as CampaignDashboardProgress
              setProgress(parsed)

              if (parsed.status === 'completed' || parsed.status === 'failed') {
                await loadBatches()
                await loadBatchData(selectedBatchId)
              }
            } catch {
              // Ignore malformed stream payloads.
            }
          }
        }
      } catch {
        // Ignore stream disconnects and rely on polling/manual refresh.
      }
    }

    void readSse()

    return () => {
      controller.abort()
      streamAbortRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, results?.batch.analysis_status, progress?.status])

  return (
    <div className="flex min-h-screen bg-[#f4f1ec]">
      <Sidebar />

      <main className="flex-1 overflow-auto p-4 md:p-6 xl:p-8">
        <div className="rounded-3xl border border-[#d9c6ad] bg-[linear-gradient(140deg,#f8ebdd_0%,#f2dec0_55%,#e7c79f_100%)] p-6 shadow-[0_20px_45px_-28px_rgba(74,44,22,0.45)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7a5e3c]">Unified Campaign Intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#2e2318] md:text-4xl">Campaign Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#5b452f] md:text-base">
            One production-ready dashboard that combines visual analytics, AI insights, assignment, workflow automation, and action operations.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="rounded-3xl border border-[#e1d1be] bg-white p-4">
              <h2 className="text-sm font-semibold text-[#2f2418]">Upload Call Sheet</h2>
              <p className="mt-1 text-xs text-[#8f7b66]">CSV or Excel. For Excel, provide Sheet1.</p>

              <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.16em] text-[#8f7b66]">Campaign Name</label>
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Expo batch - April"
                className="mt-1 w-full rounded-xl border border-[#e8dccd] bg-[#fefcf8] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
              />

              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.16em] text-[#8f7b66]">File</label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs text-[#6e5b46] file:mr-3 file:rounded-lg file:border-0 file:bg-[#edd9bf] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#5f4328]"
              />

              <button
                onClick={handleUpload}
                disabled={uploading}
                className="mt-4 w-full rounded-xl bg-[#2f2317] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#473427] disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload and Analyze'}
              </button>
            </section>

            <section className="rounded-3xl border border-[#e1d1be] bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#2f2418]">Batches</h2>
                {loadingBatches ? <span className="text-xs text-[#8f7b66]">Loading...</span> : null}
              </div>

              <div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
                {batches.map((batch) => {
                  const active = batch.id === selectedBatchId
                  return (
                    <div
                      key={batch.id}
                      className={cn(
                        'rounded-2xl border p-2 transition-colors',
                        active ? 'border-[#c79062] bg-[#fdf4e8]' : 'border-[#eee2d3] bg-white hover:bg-[#fcf7f1]',
                      )}
                    >
                      <button
                        onClick={() => setSelectedBatchId(batch.id)}
                        className="w-full rounded-xl px-1 py-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-[#2f2317]">{batch.name}</p>
                        <p className="mt-1 text-[11px] text-[#8f7b66]">
                          {batch.total_leads} leads · {batch.analysis_status}
                        </p>
                      </button>

                      {canManageBatches ? (
                        <button
                          onClick={() => void handleRemoveBatch(batch.id, batch.name)}
                          disabled={removingBatchId === batch.id}
                          className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        >
                          {removingBatchId === batch.id ? 'Removing...' : 'Remove Campaign'}
                        </button>
                      ) : null}
                    </div>
                  )
                })}
                {!loadingBatches && batches.length === 0 ? (
                  <p className="text-xs text-[#8f7b66]">No campaign batches available.</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-3xl border border-[#e1d1be] bg-white p-4">
              <h2 className="text-sm font-semibold text-[#2f2418]">Live Progress</h2>
              <p className="mt-1 text-xs text-[#8f7b66]">Server-sent event updates</p>

              <div className="mt-3 rounded-xl bg-[#f8f0e4] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8f7b66]">Status</p>
                <p className="mt-1 text-sm font-semibold text-[#2f2317]">
                  {progress?.status || selectedBatch?.analysis_status || 'idle'}
                </p>
                <p className="mt-1 text-xs text-[#7f6a54]">{progress?.message || 'No active processing'}</p>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#ecdac3]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#bb6f37_0%,#d8985f_100%)] transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, progress?.progress_pct || 0))}%` }}
                  />
                </div>

                <p className="mt-2 text-[11px] text-[#7f6a54]">
                  {(progress?.processed || 0)} / {(progress?.total || selectedBatch?.total_leads || 0)} processed
                </p>
              </div>

              <button
                onClick={handleTriggerWorkflow}
                disabled={!selectedBatchId || workflowLoading}
                className="mt-3 w-full rounded-xl border border-[#d4b08a] bg-[#f7e7d2] px-3 py-2 text-xs font-semibold text-[#694422] hover:bg-[#f3dcc2] disabled:opacity-50"
              >
                {workflowLoading ? 'Triggering...' : 'Trigger n8n Workflow'}
              </button>
            </section>
          </aside>

          <section className="min-w-0 rounded-3xl border border-[#e1d1be] bg-white p-4 md:p-5">
            <div className="flex flex-wrap gap-2 border-b border-[#eee2d4] pb-3">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                    activeTab === tab.key
                      ? 'bg-[#2f2317] text-white'
                      : 'bg-[#f7eee2] text-[#6c5841] hover:bg-[#f2e5d3]',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {!selectedBatchId ? (
              <div className="py-16 text-center text-[#8f7b66]">Upload and select a batch to start.</div>
            ) : loading ? (
              <div className="py-16 text-center text-[#8f7b66]">Loading dashboard...</div>
            ) : (
              <div className="pt-4">
                {activeTab === 'overview' ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                      <MetricCard label="Total Leads" value={derivedMetrics.total} />
                      <MetricCard label="No-connect rate" value={pct(derivedMetrics.noConnect, derivedMetrics.total)} tone="accent" />
                      <MetricCard label="Pitch reach rate" value={pct(derivedMetrics.pitchReached, derivedMetrics.total)} />
                      <MetricCard label="Conversion rate" value={pct(derivedMetrics.siteCommit, derivedMetrics.total)} />
                      <MetricCard label="Hot leads (P1)" value={derivedMetrics.hotLeads} />
                      <MetricCard label="DNC risk" value={derivedMetrics.dncRisk} sub="Flag immediately" />
                    </div>

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
                      <div className="rounded-2xl border border-[#eadfcf] bg-[#fefaf4] p-4">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Campaign Funnel</h3>
                        <div className="mt-3 space-y-2">
                          {funnelRows.map((row) => (
                            <div key={row.stage} className="flex items-center justify-between text-sm">
                              <span className="text-[#6f5b45]">{row.stage}</span>
                              <span className="font-semibold text-[#2f2317]">
                                {row.count} <span className="text-xs font-medium text-[#8f7b66]">{pct(row.count, derivedMetrics.total)}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Call Outcome Distribution</h3>
                        <div className="mt-2 h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={outcomePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={56} outerRadius={84} paddingAngle={3}>
                                {outcomePieData.map((entry, index) => (
                                  <Cell key={`${entry.name}-${index}`} fill={chartColors[index % chartColors.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Critical Issues</h3>
                        <div className="mt-3 space-y-2">
                          {criticalActions.map((item, index) => (
                            <div
                              key={`${item.title}-${index}`}
                              className={cn(
                                'rounded-xl border px-3 py-2',
                                item.level === 'high' || item.level === 'critical'
                                  ? 'border-rose-200 bg-rose-50'
                                  : item.level === 'medium'
                                    ? 'border-amber-200 bg-amber-50'
                                    : 'border-blue-200 bg-blue-50',
                              )}
                            >
                              <p className="text-xs font-semibold text-[#2f2317]">{item.title}</p>
                              <p className="mt-1 text-xs text-[#6f5b45]">{item.detail}</p>
                            </div>
                          ))}
                          {criticalActions.length === 0 ? <p className="text-xs text-[#8f7b66]">No critical issues detected.</p> : null}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                      <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Quality Dimension Breakdown</h3>
                        <div className="mt-2 h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={qualityBarData} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                              <XAxis type="number" domain={[0, 10]} hide />
                              <YAxis type="category" dataKey="name" width={125} tick={{ fill: '#6f5b45', fontSize: 12 }} axisLine={false} tickLine={false} />
                              <Tooltip />
                              <Bar dataKey="value" radius={[8, 8, 8, 8]}>
                                {qualityBarData.map((row, index) => (
                                  <Cell key={`${row.name}-${index}`} fill={chartColors[index % chartColors.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Quality Score Distribution</h3>
                        <div className="mt-2 h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={qualityDistributionData}>
                              <XAxis dataKey="bucket" tick={{ fill: '#6f5b45', fontSize: 12 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fill: '#6f5b45', fontSize: 12 }} axisLine={false} tickLine={false} />
                              <Tooltip />
                              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                                {qualityDistributionData.map((row, index) => (
                                  <Cell key={`${row.bucket}-${index}`} fill={chartColors[index % chartColors.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                      <h3 className="text-sm font-semibold text-[#2f2317]">Time Window Analysis</h3>
                      <div className="mt-2 h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hourlyData}>
                            <XAxis dataKey="hour" tick={{ fill: '#6f5b45', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#6f5b45', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#d67a47" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'queue' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        {filters.map((filter) => (
                          <button
                            key={filter}
                            onClick={() => setQueueFilter(filter)}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                              queueFilter === filter
                                ? 'border-[#2f2317] bg-[#2f2317] text-white'
                                : 'border-[#e6dacb] bg-white text-[#6c5841] hover:bg-[#f7f0e5]',
                            )}
                          >
                            {filter}
                            {filter === 'ALL' ? ` (${allLeads.length})` : ''}
                            {filter === 'RETRY' ? ` (${retryLeadCount})` : ''}
                            {filter === 'DNC' ? ` (${allLeads.filter((l) => l.dnd_flag).length})` : ''}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search lead, phone, reason"
                          className="w-[240px] rounded-xl border border-[#e8dccd] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
                        />
                        <button
                          onClick={exportQueueCsv}
                          className="rounded-xl border border-[#d6b28b] bg-[#f8e7d1] px-3 py-2 text-xs font-semibold text-[#6a4422]"
                        >
                          Export CSV
                        </button>
                      </div>
                    </div>

                    <div className="overflow-auto rounded-2xl border border-[#eadfcf]">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#f8f0e4] text-xs uppercase tracking-[0.14em] text-[#6c5841]">
                          <tr>
                            <th className="px-3 py-2 text-left">Priority</th>
                            <th className="px-3 py-2 text-left">Lead</th>
                            <th className="px-3 py-2 text-left">Outcome</th>
                            <th className="px-3 py-2 text-left">WA Number</th>
                            <th className="px-3 py-2 text-left">Callback Window</th>
                            <th className="px-3 py-2 text-left">DND Flag</th>
                            <th className="px-3 py-2 text-left">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queuePageLeads.map((lead) => (
                            <tr key={lead.id} className="cursor-pointer border-t border-[#f1e7dc] hover:bg-[#fcf8f2]" onClick={() => openLead(lead.id)}>
                              <td className="px-3 py-2">
                                <Badge tier={lead.priority_tier} />
                              </td>
                              <td className="px-3 py-2">
                                <p className="font-semibold text-[#2f2317]">{lead.name || 'Unnamed'}</p>
                                <p className="text-xs text-[#8f7b66]">{lead.phone_number || '-'}</p>
                              </td>
                              <td className="px-3 py-2 text-xs text-[#6f5b45]">{lead.drop_reason || lead.intent_level || '-'}</td>
                              <td className="px-3 py-2 text-xs text-[#6f5b45]">{lead.whatsapp_number_captured || lead.phone_number || '-'}</td>
                              <td className="px-3 py-2 text-xs text-[#6f5b45]">
                                {lead.callback_urgency_hours ? `Within ${lead.callback_urgency_hours}h` : '-'}
                              </td>
                              <td className="px-3 py-2">
                                {lead.dnd_flag ? (
                                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Yes</span>
                                ) : (
                                  <span className="rounded-full border border-[#e6dacb] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#7f6b56]">No</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-[#6f5b45]">{lead.recommended_action || lead.action_taken || '-'}</td>
                            </tr>
                          ))}

                          {queuePageLeads.length === 0 ? (
                            <tr>
                              <td className="px-3 py-8 text-center text-[#8f7b66]" colSpan={7}>
                                No leads found for current filters.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[#7f6b56]">
                      <p>
                        Showing {queuePageLeads.length} of {queueFilteredLeads.length} leads
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQueuePage((prev) => Math.max(1, prev - 1))}
                          disabled={queuePage <= 1}
                          className="rounded-lg border border-[#e4d4bf] px-3 py-1 disabled:opacity-50"
                        >
                          Prev
                        </button>
                        <span>
                          {queuePage}/{totalQueuePages}
                        </span>
                        <button
                          onClick={() => setQueuePage((prev) => Math.min(totalQueuePages, prev + 1))}
                          disabled={queuePage >= totalQueuePages}
                          className="rounded-lg border border-[#e4d4bf] px-3 py-1 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'insights' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {insightCategories.map((category) => (
                        <button
                          key={category}
                          onClick={() => setSelectedInsightCategory(category)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                            selectedInsightCategory === category
                              ? 'border-[#2f2317] bg-[#2f2317] text-white'
                              : 'border-[#e6dacb] bg-white text-[#6c5841] hover:bg-[#f7f0e5]',
                          )}
                        >
                          {category}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Strategic Insights</h3>
                        <div className="mt-3 space-y-2">
                          {filteredInsights.map((insight, index) => (
                            <div key={`${String(insight.title || index)}-${index}`} className="rounded-xl border border-[#eadfcf] bg-[#fffaf3] px-3 py-2">
                              <p className="text-sm font-semibold text-[#2f2317]">{String(insight.title || `Insight ${index + 1}`)}</p>
                              <p className="mt-1 text-xs text-[#6f5b45]">{String(insight.finding || insight.action || 'No detail')}</p>
                              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
                                <span className="rounded-full border border-[#e7d8c6] bg-white px-2 py-0.5 text-[#8f7b66]">{String(insight.category || 'general')}</span>
                                <span className="rounded-full border border-[#e7d8c6] bg-white px-2 py-0.5 text-[#8f7b66]">priority: {String(insight.priority || 'n/a')}</span>
                                <span className="rounded-full border border-[#e7d8c6] bg-white px-2 py-0.5 text-[#8f7b66]">impact: {String(insight.impact || 'n/a')}</span>
                              </div>
                            </div>
                          ))}
                          {filteredInsights.length === 0 ? <p className="text-sm text-[#8f7b66]">No insights in this category.</p> : null}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                          <h3 className="text-sm font-semibold text-[#2f2317]">Three Things To Do Today</h3>
                          <ul className="mt-2 space-y-2 text-sm text-[#6f5b45]">
                            {threeThingsToday.map((item, index) => (
                              <li key={`${item}-${index}`} className="rounded-lg border border-[#eee4d6] bg-[#fefbf6] px-3 py-2">{item}</li>
                            ))}
                            {threeThingsToday.length === 0 ? <li className="text-[#8f7b66]">No immediate actions provided.</li> : null}
                          </ul>
                        </div>

                        <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                          <h3 className="text-sm font-semibold text-[#2f2317]">Next Campaign Changes</h3>
                          <ul className="mt-2 space-y-2 text-sm text-[#6f5b45]">
                            {nextCampaignChanges.map((item, index) => (
                              <li key={`${item}-${index}`} className="rounded-lg border border-[#eee4d6] bg-[#fefbf6] px-3 py-2">{item}</li>
                            ))}
                            {nextCampaignChanges.length === 0 ? <li className="text-[#8f7b66]">No optimization changes generated yet.</li> : null}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                      <h3 className="text-sm font-semibold text-[#2f2317]">Script and Conversation Gaps</h3>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {scriptIssueRows.map((row) => (
                          <div key={row.issue} className="rounded-xl border border-[#eadfcf] bg-[#fffaf3] px-3 py-2">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#8f7b66]">Issue</p>
                            <p className="mt-1 text-sm font-semibold text-[#2f2317]">{row.issue}</p>
                            <p className="mt-1 text-xs text-[#6f5b45]">{row.count} leads affected</p>
                          </div>
                        ))}
                        {scriptIssueRows.length === 0 ? <p className="text-sm text-[#8f7b66]">No script issues detected.</p> : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'assignment' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[#2f2317]">Agent Assignment Board</h3>
                        <p className="text-sm text-[#7f6b56]">
                          Assignment is priority-based: top half of leads go to the first agent half, lower half to the second.
                          Only selected agents are used; if none selected, assignment defaults to active call_agent users.
                        </p>
                      </div>

                      <button
                        onClick={applyAutoAssignment}
                        disabled={assigning || suggestedAssignments.length === 0}
                        className="rounded-xl bg-[#2f2317] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {assigning ? 'Assigning...' : `Auto-Assign ${suggestedAssignments.length} Leads`}
                      </button>
                    </div>

                    <div className="rounded-2xl border border-[#eadfcf] bg-[#fefbf6] p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#2f2317]">Selected Assignment Agents</p>
                        <div className="flex gap-2">
                          <button
                            onClick={useDefaultCallAgentPool}
                            className="rounded-full border border-[#d8c4ad] bg-white px-3 py-1 text-xs font-semibold text-[#6a4b32]"
                          >
                            Use default call_agent
                          </button>
                          <button
                            onClick={clearAssignmentSelection}
                            className="rounded-full border border-[#e3d7c8] bg-white px-3 py-1 text-xs font-semibold text-[#7f6b56]"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {activeAgents.map((agent) => {
                          const selected = selectedAssignmentAgentIds.includes(agent.id)
                          return (
                            <button
                              key={agent.id}
                              onClick={() => toggleAssignmentAgent(agent.id)}
                              className={cn(
                                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                                selected
                                  ? 'border-[#2f2317] bg-[#2f2317] text-white'
                                  : 'border-[#e2d2bd] bg-white text-[#5f5348] hover:bg-[#fcf7f0]',
                              )}
                            >
                              {agent.name} ({agent.role})
                            </button>
                          )
                        })}
                      </div>

                      <p className="mt-3 text-[11px] text-[#8f7b66]">
                        {selectedAssignmentAgentIds.length === 0
                          ? `No explicit selection active. Using call_agent role pool (${activeAgents.filter((agent) => agent.role === 'call_agent').length} agent(s)).`
                          : `Using ${selectedAssignmentAgentIds.length} selected agent(s) for auto-assignment.`}
                      </p>
                    </div>

                    {assignableAgents.length === 0 ? (
                      <div className="rounded-2xl border border-[#eadfcf] bg-[#fefbf6] p-4 text-sm text-[#8f7b66]">
                        No assignment candidates found. Select agents, or create active users with role call_agent.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                        {assignableAgents.map((agent) => {
                          const items = assignmentBoard[agent.name] || []
                          const p1p2 = items.filter((i) => ['P1', 'P2'].includes(i.tier)).length
                          const p3 = items.filter((i) => i.tier === 'P3').length
                          const p4p5 = items.filter((i) => ['P4', 'P5'].includes(i.tier)).length

                          return (
                            <div key={agent.id} className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-[#2f2317]">{agent.name}</p>
                                  <p className="text-xs text-[#8f7b66]">{items.length} suggested tasks</p>
                                </div>
                                <span className="rounded-full border border-[#e6dacb] bg-[#faf4e8] px-2 py-0.5 text-[10px] font-semibold text-[#7f6b56]">
                                  {agent.role}
                                </span>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold">
                                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">P1+P2 {p1p2}</span>
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">P3 {p3}</span>
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">P4+P5 {p4p5}</span>
                              </div>

                              <div className="mt-3 max-h-[220px] space-y-2 overflow-auto pr-1">
                                {items.slice(0, 10).map((item) => (
                                  <button
                                    key={item.leadId}
                                    onClick={() => openLead(item.leadId)}
                                    className="flex w-full items-center justify-between rounded-lg border border-[#efe5d8] bg-[#fffaf3] px-2 py-1.5 text-left hover:bg-[#fcf3e8]"
                                  >
                                    <span className="truncate text-xs font-medium text-[#2f2317]">{item.leadName}</span>
                                    <Badge tier={item.tier} />
                                  </button>
                                ))}
                                {items.length === 0 ? <p className="text-xs text-[#8f7b66]">No assigned leads.</p> : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                {activeTab === 'copilot' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {[
                        'Who are the top 5 leads to call first?',
                        'Why is conversion low in this batch?',
                        'What script fixes should we deploy today?',
                        'Which leads should move to DNC?',
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => setChatInput(prompt)}
                          className="rounded-full border border-[#e7dccd] bg-[#faf4e8] px-3 py-1 text-xs font-semibold text-[#6f5b45]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>

                    <div className="h-[380px] overflow-auto rounded-2xl border border-[#eadfcf] bg-[#fefbf6] p-3">
                      {chatHistory.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={cn(
                            'mb-2 max-w-[90%] rounded-xl px-3 py-2 text-sm',
                            message.role === 'user'
                              ? 'ml-auto bg-[#2f2317] text-white'
                              : 'border border-[#e8dccd] bg-white text-[#2f2317]',
                          )}
                        >
                          {message.content}
                        </div>
                      ))}
                      {chatHistory.length === 0 ? (
                        <p className="text-sm text-[#8f7b66]">
                          Ask questions about lead quality, timing windows, objection clusters, and follow-up strategy.
                        </p>
                      ) : null}
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleSendChat()
                          }
                        }}
                        placeholder="Ask campaign copilot"
                        className="flex-1 rounded-xl border border-[#e8dccd] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
                      />
                      <button
                        onClick={handleSendChat}
                        disabled={chatBusy || !chatInput.trim()}
                        className="rounded-xl bg-[#2f2317] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {chatBusy ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'actions' ? (
                  <div className="space-y-4">
                    {selectedLead ? (
                      <div className="rounded-2xl border border-[#eadfcf] bg-[#fefbf6] p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[#8f7b66]">Selected Lead</p>
                        <div className="mt-1 flex items-center gap-2">
                          <p className="text-lg font-semibold text-[#2f2317]">{selectedLead.name || 'Unnamed'}</p>
                          <Badge tier={selectedLead.priority_tier} />
                        </div>
                        <p className="text-sm text-[#7f6b56]">{selectedLead.phone_number || '-'}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-[#8f7b66]">Select a lead from Priority Queue to update actions.</p>
                    )}

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input
                        value={actionForm.assigned_agent}
                        onChange={(e) => setActionForm((prev) => ({ ...prev, assigned_agent: e.target.value }))}
                        placeholder="Assigned agent"
                        className="rounded-xl border border-[#e8dccd] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
                      />
                      <input
                        value={actionForm.action_taken}
                        onChange={(e) => setActionForm((prev) => ({ ...prev, action_taken: e.target.value }))}
                        placeholder="Action taken"
                        className="rounded-xl border border-[#e8dccd] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
                      />
                    </div>

                    <textarea
                      value={actionForm.notes}
                      onChange={(e) => setActionForm((prev) => ({ ...prev, notes: e.target.value }))}
                      rows={3}
                      placeholder="Internal notes"
                      className="w-full rounded-xl border border-[#e8dccd] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
                    />

                    <div className="flex flex-wrap items-center gap-4 text-sm text-[#6f5b45]">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={actionForm.whatsapp_sent}
                          onChange={(e) => setActionForm((prev) => ({ ...prev, whatsapp_sent: e.target.checked }))}
                        />
                        WhatsApp sent
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={actionForm.dnd_flag}
                          onChange={(e) => setActionForm((prev) => ({ ...prev, dnd_flag: e.target.checked }))}
                        />
                        DND
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleSaveAction}
                        disabled={!selectedLeadId || actionSaving}
                        className="rounded-xl bg-[#2f2317] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {actionSaving ? 'Saving...' : 'Save Action'}
                      </button>
                      <button
                        onClick={handleGenerateScript}
                        disabled={!selectedLeadId || scriptLoading}
                        className="rounded-xl border border-[#d3af89] bg-[#f8e7d1] px-4 py-2 text-sm font-semibold text-[#6b4523] disabled:opacity-50"
                      >
                        {scriptLoading ? 'Generating...' : 'Generate Callback Script'}
                      </button>
                    </div>

                    <div className="rounded-2xl border border-[#eadfcf] bg-white p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-[#2f2317]">Unresolved Red Flags</h3>
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                          {flags.length}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {flags.slice(0, 8).map((flag) => (
                          <div key={flag.id} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-rose-800">{flag.flag_type}</p>
                                <p className="mt-1 text-xs text-rose-700">{flag.description}</p>
                              </div>
                              <button
                                onClick={() => handleResolveFlag(flag.id)}
                                className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700"
                              >
                                Resolve
                              </button>
                            </div>
                          </div>
                        ))}

                        {flags.length === 0 ? <p className="text-sm text-[#8f7b66]">No unresolved red flags.</p> : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </main>

      {leadDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={() => setLeadDrawerOpen(false)}>
          <aside className="h-full w-full max-w-[560px] overflow-auto bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[#8f7b66]">Lead Detail</p>
                <h2 className="mt-1 text-xl font-semibold text-[#2f2317]">{String(leadDetails?.lead?.name || 'Unnamed')}</h2>
                <p className="text-sm text-[#8f7b66]">{String(leadDetails?.lead?.phone_number || '-')}</p>
              </div>
              <button
                onClick={() => setLeadDrawerOpen(false)}
                className="rounded-lg border border-[#e7dccd] px-2 py-1 text-sm text-[#6f5b45]"
              >
                Close
              </button>
            </div>

            {leadLoading ? (
              <p className="mt-6 text-sm text-[#8f7b66]">Loading lead details...</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-[#eadfcf] bg-[#fefbf6] p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8f7b66]">AI Summary</p>
                  <p className="mt-2 text-sm text-[#2f2317]">
                    {String(leadDetails?.lead?.enriched_summary || leadDetails?.lead?.summary || 'No summary')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[#eadfcf] p-3">
                    <p className="text-xs text-[#8f7b66]">Tier</p>
                    <p className="mt-1 text-sm font-semibold text-[#2f2317]">{String(leadDetails?.lead?.priority_tier || '-')}</p>
                  </div>
                  <div className="rounded-xl border border-[#eadfcf] p-3">
                    <p className="text-xs text-[#8f7b66]">Lead Score</p>
                    <p className="mt-1 text-sm font-semibold text-[#2f2317]">{String(leadDetails?.lead?.lead_score ?? '-')}</p>
                  </div>
                  <div className="rounded-xl border border-[#eadfcf] p-3">
                    <p className="text-xs text-[#8f7b66]">Drop Reason</p>
                    <p className="mt-1 text-sm font-semibold text-[#2f2317]">{String(leadDetails?.lead?.drop_reason || '-')}</p>
                  </div>
                  <div className="rounded-xl border border-[#eadfcf] p-3">
                    <p className="text-xs text-[#8f7b66]">Recommended Action</p>
                    <p className="mt-1 text-sm font-semibold text-[#2f2317]">{String(leadDetails?.lead?.recommended_action || '-')}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8f7b66]">Transcript</p>
                  <div className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#eadfcf] bg-[#fefbf6] p-3 text-sm text-[#3a2d20]">
                    {String(leadDetails?.lead?.transcript || 'No transcript')}
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8f7b66]">Callback Script</p>
                  <textarea
                    value={actionForm.callback_script}
                    onChange={(e) => setActionForm((prev) => ({ ...prev, callback_script: e.target.value }))}
                    rows={6}
                    className="mt-2 w-full rounded-xl border border-[#e8dccd] px-3 py-2 text-sm outline-none focus:border-[#cfac84]"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleGenerateScript}
                    disabled={!selectedLeadId || scriptLoading}
                    className="rounded-xl border border-[#d3af89] bg-[#f8e7d1] px-4 py-2 text-sm font-semibold text-[#6b4523] disabled:opacity-50"
                  >
                    {scriptLoading ? 'Generating...' : 'Regenerate Script'}
                  </button>
                  <button
                    onClick={handleSaveAction}
                    disabled={!selectedLeadId || actionSaving}
                    className="rounded-xl bg-[#2f2317] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {actionSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
