import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { campaignsApi, leadsApi, projectsApi, tasksApi, analyticsApi, notificationsApi, propertiesApi, contactsApi, visitsApi } from '@/lib/api'

// ─── LEADS ───────────────────────────────────────────────────────────────────
export const useLeads = (params?: Record<string, string>) =>
  useQuery({ queryKey: ['leads', params], queryFn: () => leadsApi.list(params), staleTime: 30000, refetchInterval: 10000 })

export const useKanbanBoard = () =>
  useQuery({ queryKey: ['kanban'], queryFn: leadsApi.board, staleTime: 30000, refetchInterval: 10000 })

export const useLead = (id: string) =>
  useQuery({ queryKey: ['lead', id], queryFn: () => leadsApi.get(id), enabled: !!id, refetchInterval: 10000 })

export const useLeadTimeline = (id: string) =>
  useQuery({ queryKey: ['timeline', id], queryFn: () => leadsApi.timeline(id), enabled: !!id, refetchInterval: 10000 })

export const usePropertyMatches = (leadId: string) =>
  useQuery({ queryKey: ['matches', leadId], queryFn: () => leadsApi.propertyMatches(leadId), enabled: !!leadId })

export const useUpdateStage = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stage, lost_reason }: { id: string; stage: string; lost_reason?: string }) =>
      leadsApi.updateStage(id, stage, lost_reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kanban'] }); qc.invalidateQueries({ queryKey: ['leads'] }) },
  })
}

export const useAddNote = (leadId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (description: string) => leadsApi.addNote(leadId, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', leadId] }),
  })
}

export const useLogCall = (leadId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { outcome: string; description?: string; duration_seconds?: number }) =>
      leadsApi.logCall(leadId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', leadId] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}

// ─── TASKS ───────────────────────────────────────────────────────────────────
export const useTodayTasks = () =>
  useQuery({ queryKey: ['tasks', 'today'], queryFn: tasksApi.today, staleTime: 60000, refetchInterval: 10000 })

export const useAllTasks = (params?: Record<string, string>) =>
  useQuery({ queryKey: ['tasks', params], queryFn: () => tasksApi.list(params), refetchInterval: 10000 })

export const useCompleteTask = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: tasksApi.complete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
    },
  })
}

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
export const useAnalyticsSummary = (days = 30) =>
  useQuery({ queryKey: ['analytics', 'summary', days], queryFn: () => analyticsApi.summary(days), staleTime: 60000 })

export const useFunnel = () =>
  useQuery({ queryKey: ['analytics', 'funnel'], queryFn: analyticsApi.funnel, staleTime: 60000 })

export const useSourceStats = () =>
  useQuery({ queryKey: ['analytics', 'source'], queryFn: analyticsApi.bySource, staleTime: 60000 })

export const useAgentStats = () =>
  useQuery({ queryKey: ['analytics', 'agents'], queryFn: analyticsApi.agentPerformance, staleTime: 60000 })

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list, refetchInterval: 5000 })

// ─── PROPERTIES ──────────────────────────────────────────────────────────────
export const useProperties = (params?: Record<string, unknown>) =>
  useQuery({ queryKey: ['properties', params], queryFn: () => propertiesApi.list(params) })

// ─── CONTACTS ────────────────────────────────────────────────────────────────
export const useContacts = (search?: string) =>
  useQuery({ queryKey: ['contacts', search], queryFn: () => contactsApi.list(search) })

// ─── VISITS ──────────────────────────────────────────────────────────────────
export const useVisits = () =>
  useQuery({ queryKey: ['visits'], queryFn: () => visitsApi.list(), refetchInterval: 10000 })

// ─── CAMPAIGNS ─────────────────────────────────────────────────────────────
export const useCampaigns = (skip = 0, limit = 50) =>
  useQuery({ queryKey: ['campaigns', skip, limit], queryFn: () => campaignsApi.getCampaigns(skip, limit) })

export const useCampaign = (id: string) =>
  useQuery({ queryKey: ['campaign', id], queryFn: () => campaignsApi.getCampaign(id), enabled: !!id })

export const useCampaignAnalytics = (id: string) =>
  useQuery({
    queryKey: ['campaign-analytics', id],
    queryFn: () => campaignsApi.getCampaignAnalytics(id),
    enabled: !!id,
  })

export const useCampaignLeadsDetail = (id: string, params?: { tier?: string; search?: string }) =>
  useQuery({
    queryKey: ['campaign-leads-detail', id, params?.tier ?? '', params?.search ?? ''],
    queryFn: () => campaignsApi.getCampaignLeadsDetail(id, params),
    enabled: !!id,
  })

export const useAgentAssignments = (id: string) =>
  useQuery({
    queryKey: ['campaign-agent-assignments', id],
    queryFn: () => campaignsApi.getAgentAssignments(id),
    enabled: !!id,
  })

export const useProjects = () =>
  useQuery({ queryKey: ['projects'], queryFn: campaignsApi.listProjects })

export const useProjectsModule = () =>
  useQuery({ queryKey: ['projects-module'], queryFn: projectsApi.list })

export const useProjectDetail = (id: string) =>
  useQuery({ queryKey: ['project-detail', id], queryFn: () => projectsApi.detail(id), enabled: !!id })
