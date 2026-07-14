import axios from 'axios'
import type {
  Agent, Lead, Contact, Property, Task, Activity,
  SiteVisit, Notification, AnalyticsSummary, FunnelStage,
  SourceStat, AgentStat, KanbanBoard, TokenResponse,
  MetaMarketingStats,
  Campaign, CampaignDetail, CampaignIngestPayload, CampaignPreview, CampaignResult,
  CampaignAnalytics, CampaignLeadDetail, AgentAssignment, Project, ProjectDetail,
  LeadPaginatedResponse,
  CampaignDashboardAnalytics,
  CampaignDashboardBatch,
  CampaignDashboardFlag,
  CampaignDashboardLeadDetails,
  CampaignDashboardProgress,
  CampaignDashboardResults,
  LeadNotifyPayload,
  AdminBroadcastPayload,
  TaskCompleteWithRemarkPayload,
  DNCFlagPayload,
  MasterProfile,
  AssignmentTableResponse,
  BulkAssignPayload,
  LeaderboardEntry,
  AgentPerformanceResponse,
  DemographicsProfile,
  TaskCompleteDemographicPayload,
} from './types'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('propello_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Sign out on 401 — but only after confirming the token is really invalid, so a
// transient/racey 401 (e.g. a DB-pooler blip after the app was idle during a
// phone call) doesn't log agents out mid-shift.
async function forceLogout() {
  localStorage.removeItem('propello_token')
  localStorage.removeItem('propello_agent')
  window.location.href = '/login'
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err.response?.status
    const url: string = err.config?.url || ''
    if (status === 401 && typeof window !== 'undefined') {
      const token = localStorage.getItem('propello_token')
      const isAuthCall = url.includes('/auth/')
      if (!token || isAuthCall) {
        await forceLogout()
        return Promise.reject(err)
      }
      // Verify the token before nuking the session.
      try {
        await axios.get(`${api.defaults.baseURL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 8000,
        })
        // Token still valid → this was a transient error; keep the agent signed in.
        return Promise.reject(err)
      } catch (verifyErr: any) {
        if (verifyErr?.response?.status === 401) {
          await forceLogout()
        }
        // Any other failure (network/timeout) → keep the session, just surface the error.
      }
    }
    return Promise.reject(err)
  }
)

// ─── AUTH ────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<TokenResponse>('/api/auth/login', { email, password }).then(r => r.data),
  me: () => api.get<Agent>('/api/auth/me').then(r => r.data),
  listAgents: () => api.get<Agent[]>('/api/auth/agents').then(r => r.data),
  createAgent: (data: { name: string; email: string; password: string; role: string; phone?: string }) =>
    api.post<Agent>('/api/auth/agents', data).then(r => r.data),
  updateAgentRole: (id: string, role: string) =>
    api.patch<Agent>(`/api/auth/agents/${id}/role`, { role }).then(r => r.data),
  deleteAgent: (id: string) => api.delete(`/api/auth/agents/${id}`).then(r => r.data),
  // Agent rating & performance (Feature 5 & 6)
  setAgentRating: (id: string, starRating: number) =>
    api.post<Agent>(`/api/auth/agents/${id}/rating`, { star_rating: starRating }).then(r => r.data),
  getLeaderboard: () => api.get<LeaderboardEntry[]>('/api/auth/agents/leaderboard').then(r => r.data),
  getAgentPerformance: (id: string) =>
    api.get<AgentPerformanceResponse>(`/api/auth/agents/${id}/performance`).then(r => r.data),
}

// ─── MY DATA (Scoped for call_agent) ────────────────────────────────────────
export const meApi = {
  getTasks: (status?: string) => api.get<Task[]>('/api/me/tasks', { params: { status } }).then(r => r.data),
  getLeads: (params?: { stage?: string; search?: string; skip?: number; limit?: number }) =>
    api.get<Lead[]>('/api/me/leads', { params }).then(r => r.data),
  getPerformance: () => api.get<AgentPerformanceResponse>('/api/me/performance').then(r => r.data),
  summary: (days = 30) => api.get<AnalyticsSummary>('/api/me/summary', { params: { days } }).then(r => r.data),
}

// ─── LEADS ───────────────────────────────────────────────────────────────────
export const leadsApi = {
  list: (params?: { stage?: string; source?: string; lead_score?: string; assigned_to?: string; search?: string; skip?: number; limit?: number }) =>
    api.get<Lead[]>('/api/leads', { params }).then(r => r.data),
  listPaginated: (params?: {
    stage?: string; source?: string; lead_score?: string; assigned_to?: string;
    campaign_id?: string; search?: string; page?: number; page_size?: number;
    sentiment?: string; whatsapp_status?: string; assigned?: string; retry?: string;
    min_score?: number; max_score?: number;
    date_filter?: string; date_from?: string; date_to?: string;
  }) =>
    api.get<LeadPaginatedResponse>('/api/leads/paginated', { params }).then(r => r.data),
  board: () => api.get<KanbanBoard>('/api/leads/board').then(r => r.data),
  get: (id: string) => api.get<Lead>(`/api/leads/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post<Lead>('/api/leads', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Lead>(`/api/leads/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/leads/${id}`).then(r => r.data),
  updateStage: (id: string, stage: string, lost_reason?: string) =>
    api.patch<Lead>(`/api/leads/${id}/stage`, { stage, lost_reason }).then(r => r.data),
  timeline: (id: string) => api.get<Activity[]>(`/api/leads/${id}/timeline`).then(r => r.data),
  addNote: (id: string, description: string) =>
    api.post<Activity>(`/api/leads/${id}/note`, { description }).then(r => r.data),
  logCall: (id: string, data: { outcome: string; description?: string; duration_seconds?: number }) =>
    api.post<Activity>(`/api/leads/${id}/call-log`, data).then(r => r.data),
  sendWhatsApp: (id: string, template: string, custom_message?: string) =>
    api.post(`/api/leads/${id}/whatsapp`, { template, lead_id: id, custom_message }).then(r => r.data),
  campaignTrigger: (id: string, message: string, campaign: string) =>
    api.post(`/api/leads/${id}/campaign-trigger`, { message, campaign }).then(r => r.data),
  getWhatsAppChats: (id: string) =>
    api.get<{ id: string; direction: string; message: string; sender_name: string | null; timestamp: string }[]>(`/api/whatsapp/lead/${id}`).then(r => r.data),
  notify: (id: string, payload: LeadNotifyPayload) =>
    api.post(`/api/leads/${id}/notify`, payload).then(r => r.data),
  propertyMatches: (id: string) => api.get<Property[]>(`/api/leads/${id}/property-matches`).then(r => r.data),
  getMasterProfile: (id: string) => api.get<MasterProfile>(`/api/leads/${id}/master-profile`).then(r => r.data),
  updateMasterProfile: (id: string, data: Partial<MasterProfile>) => api.patch(`/api/leads/${id}/master-profile`, data).then(r => r.data),
  getCampaignAssignmentTable: (campaignId: string, params?: { page?: number; limit?: number; priority_tier?: string; assigned?: string; agent_name?: string; search?: string; sort_by?: string; sort_dir?: string }) =>
    api.get(`/api/leads/campaign/${campaignId}/assignment-table`, { params }).then(r => r.data),
  bulkAssignCampaignLeads: (campaignId: string, payload: BulkAssignPayload) =>
    api.post<{ status: string; assigned: number; reassigned: number; agent_name: string; agent_id: string; campaign_id: string }>(
      `/api/leads/campaign/${campaignId}/bulk-assign`,
      payload,
    ).then(r => r.data),
  reassign: (id: string, agent_id: string, reason = 'Manual reassignment') =>
    api.post(`/api/leads/${id}/reassign`, { agent_id, reason }).then(r => r.data),
  distribute: (payload?: { selected_agent_ids?: string[]; only_unassigned?: boolean; lead_ids?: string[] }) =>
    api.post<{ status: string; assigned: number; agents: number; breakdown: { agent_id: string; agent_name: string; assigned: number }[] }>(
      '/api/leads/distribute',
      payload ?? {},
    ).then(r => r.data),
  deleteUploadedLeads: () =>
    api.post<{ status: string; deleted_leads: number; deleted_contacts: number }>(
      '/api/leads/delete-uploaded', {},
    ).then(r => r.data),
  unassignAgent: (agent_id: string) =>
    api.post<{ status: string; unassigned: number }>(
      '/api/leads/unassign-agent', { agent_id },
    ).then(r => r.data),
  uploadLeads: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const token = typeof window !== 'undefined' ? localStorage.getItem('propello_token') : null
    // Strip any trailing slash from baseURL to avoid a double slash (//api/...)
    // which the backend treats as an unknown path and 404s ("Not Found").
    const base = (api.defaults.baseURL || '').replace(/\/+$/, '')
    const response = await fetch(`${base}/api/leads/upload`, {
      method: 'POST',
      headers: { Authorization: token ? `Bearer ${token}` : '' },
      body: form,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }))
      throw new Error(error.detail || 'Upload failed')
    }
    return response.json() as Promise<{ status: string; created: number; skipped: number; total: number; lead_ids: string[] }>
  },
  updateLeadPriority: (id: string, priority: string) =>
    api.patch<Lead>(`/api/leads/${id}/priority`, { priority }).then(r => r.data),
  getDemographics: (id: string) => api.get<DemographicsProfile>(`/api/leads/${id}/demographics`).then(r => r.data),
  updateDemographics: (id: string, data: Partial<DemographicsProfile>) =>
    api.patch<Lead>(`/api/leads/${id}/demographics`, data).then(r => r.data),
}

// ─── CONTACTS ────────────────────────────────────────────────────────────────
export const contactsApi = {
  list: (search?: string) => api.get<Contact[]>('/api/contacts', { params: { search } }).then(r => r.data),
  get: (id: string) => api.get<Contact>(`/api/contacts/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post<Contact>('/api/contacts', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Contact>(`/api/contacts/${id}`, data).then(r => r.data),
  lookup: (phone: string) => api.get(`/api/contacts/lookup/${phone}`).then(r => r.data),
}

// ─── PROPERTIES ──────────────────────────────────────────────────────────────
export const propertiesApi = {
  list: (params?: Record<string, unknown>) => api.get<Property[]>('/api/properties', { params }).then(r => r.data),
  get: (id: string) => api.get<Property>(`/api/properties/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post<Property>('/api/properties', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Property>(`/api/properties/${id}`, data).then(r => r.data),
}

// ─── TASKS ───────────────────────────────────────────────────────────────────
export const tasksApi = {
  list: (params?: Record<string, unknown>) => api.get<Task[]>('/api/tasks', { params }).then(r => r.data),
  today: () => api.get<Task[]>('/api/tasks/today').then(r => r.data),
  overdue: () => api.get<Task[]>('/api/tasks/overdue').then(r => r.data),
  create: (data: Record<string, unknown>) => api.post<Task>('/api/tasks', data).then(r => r.data),
  complete: (id: string) => api.patch<Task>(`/api/tasks/${id}/complete`).then(r => r.data),
  completeWithRemark: (id: string, data: TaskCompleteWithRemarkPayload) =>
    api.patch<Task>(`/api/tasks/${id}/complete-with-remark`, data).then(r => r.data),
  flagDnc: (data: DNCFlagPayload) => api.post(`/api/tasks/flag-dnc`, data).then(r => r.data),
  completeWithDemographic: (id: string, data: TaskCompleteDemographicPayload) =>
    api.post<Task>(`/api/tasks/${id}/complete-demographic`, data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Task>(`/api/tasks/${id}`, data).then(r => r.data),
}

// ─── VISITS ──────────────────────────────────────────────────────────────────
export const visitsApi = {
  list: (params?: { lead_id?: string }) => api.get<SiteVisit[]>('/api/visits', { params }).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post<SiteVisit>('/api/visits', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch<SiteVisit>(`/api/visits/${id}`, data).then(r => r.data),
}

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
export const analyticsApi = {
  summary: (days = 30) => api.get<AnalyticsSummary>('/api/analytics/summary', { params: { days } }).then(r => r.data),
  funnel: () => api.get<FunnelStage[]>('/api/analytics/funnel').then(r => r.data),
  bySource: () => api.get<SourceStat[]>('/api/analytics/by-source').then(r => r.data),
  agentPerformance: () => api.get<AgentStat[]>('/api/analytics/agent-performance').then(r => r.data),
  meta: (days = 30) => api.get<MetaMarketingStats>('/api/analytics/meta', { params: { days } }).then(r => r.data),
  // Leaderboard is in authApi
  agentLeaderboard: () => authApi.getLeaderboard(),
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: () => api.get<Notification[]>('/api/notifications').then(r => r.data),
  readAll: () => api.patch('/api/notifications/read-all').then(r => r.data),
  broadcast: (payload: AdminBroadcastPayload) =>
    api.post('/api/notifications/broadcast', payload).then(r => r.data),
}

// ─── CAMPAIGNS ─────────────────────────────────────────────────────────────
export const campaignsApi = {
  uploadCampaignPreview: async (file: File, campaignName: string, agentName = 'Niharika') => {
    const form = new FormData()
    form.append('file', file)
    form.append('campaign_name', campaignName)
    form.append('agent_name', agentName)

    const token = typeof window !== 'undefined' ? localStorage.getItem('propello_token') : null

    const base = (api.defaults.baseURL || '').replace(/\/+$/, '')
    const response = await fetch(`${base}/api/campaigns/upload`, {
      method: 'POST',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: form,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }))
      throw new Error(error.detail || 'Upload failed')
    }

    return response.json()
  },
  ingestCampaign: (payload: CampaignIngestPayload) =>
    api.post<CampaignResult>('/api/campaigns/ingest', payload).then(r => r.data),
  getCampaigns: (skip = 0, limit = 50) =>
    api.get<Campaign[]>('/api/campaigns', { params: { skip, limit } }).then(r => r.data),
  getCampaign: (id: string) =>
    api.get<CampaignDetail>(`/api/campaigns/${id}`).then(r => r.data),
  getCampaignAnalytics: (id: string) =>
    api.get<CampaignAnalytics>(`/api/campaigns/${id}/analytics`).then(r => r.data),
  getCampaignLeadsDetail: (id: string, params?: { tier?: string; search?: string }) =>
    api.get<CampaignLeadDetail[]>(`/api/campaigns/${id}/leads-detail`, { params }).then(r => r.data),
  triggerAiAnalysis: (id: string) =>
    api.post<{ analyzed: number; skipped: number; errors: number; message: string }>(`/api/campaigns/${id}/analyze-ai`).then(r => r.data),
  getAgentAssignments: (id: string, selectedAgentIds?: string[]) =>
    api.get<AgentAssignment[]>(`/api/campaigns/${id}/agent-assignments`, {
      params: selectedAgentIds && selectedAgentIds.length > 0
        ? { selected_agent_ids: selectedAgentIds }
        : undefined,
    }).then(r => r.data),
  executeAgentAssignment: (id: string, selectedAgentIds?: string[]) =>
    api.post<{ assigned: number; agents: number }>(`/api/campaigns/${id}/assign-agents`, {
      selected_agent_ids: selectedAgentIds || [],
    }).then(r => r.data),
  autoAssignCampaign: (id: string) =>
    api.post<{ assigned: number; agents: number }>(`/api/campaigns/${id}/assign-agents`, {
      selected_agent_ids: [],
    }).then(r => r.data),
  listProjects: () =>
    api.get<Project[]>('/api/campaigns/projects').then(r => r.data),
  assignProject: (campaignId: string, projectId: string) =>
    api.patch(`/api/campaigns/${campaignId}/project/${projectId}`).then(r => r.data),
  removeProject: (campaignId: string) =>
    api.delete(`/api/campaigns/${campaignId}/project`).then(r => r.data),
  deleteCampaign: (campaignId: string) =>
    api.delete<{ status: string; campaign_id: string; campaign_name: string }>(`/api/campaigns/${campaignId}`).then(r => r.data),
  getWhatsAppTemplates: () =>
    api.get<{ id: string; name: string; body: string; status: string; language: string }[]>('/api/campaigns/whatsapp-templates').then(r => r.data),
  triggerCampaignWhatsApp: (campaignId: string, payload: { message: string; template_name?: string; campaign_tag?: string }) =>
    api.post<{ total: number; sent: number; failed: number; skipped: number; results: { lead_id: string; phone?: string; status: string; reason?: string }[] }>(`/api/campaigns/${campaignId}/trigger-whatsapp`, payload).then(r => r.data),
  broadcastPhones: (payload: { phones: string[]; message: string; template_name?: string; language?: string; variable_name?: string; campaign_tag?: string }) =>
    api.post<{ total: number; sent: number; failed: number; results: { phone: string; status: string; reason?: string }[] }>('/api/campaigns/broadcast-phones', payload).then(r => r.data),
}

// ─── CAMPAIGN DASHBOARD (UNIFIED) ─────────────────────────────────────────
export const campaignDashboardApi = {
  uploadCallSheet: (file: File, campaignName: string) => {
    const form = new FormData()
    form.append('campaign_name', campaignName)
    form.append('file', file)
    return api.post<{ batch_id: string; status: string; message: string }>(
      '/api/campaign/upload-call-sheet',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ).then(r => r.data)
  },
  getBatches: (limit = 25) =>
    api.get<{ count: number; items: CampaignDashboardBatch[] }>('/api/campaign/batches', { params: { limit } }).then(r => r.data),
  deleteBatch: (batchId: string) =>
    api.delete<{ status: string; batch_id: string; batch_name: string; deleted: boolean }>(`/api/campaign/batch/${batchId}`).then(r => r.data),
  getStatus: (batchId: string) =>
    api.get<{ batch_id: string; analysis_status: string; progress: CampaignDashboardProgress }>(`/api/campaign/campaign-status/${batchId}`).then(r => r.data),
  getResults: (batchId: string, params?: { page?: number; limit?: number; priority_tier?: string; intent_level?: string; search?: string; dnd_only?: boolean }) =>
    api.get<CampaignDashboardResults>(`/api/campaign/campaign-results/${batchId}`, { params }).then(r => r.data),
  getLeadDetails: (leadId: string) =>
    api.get<CampaignDashboardLeadDetails>(`/api/campaign/lead-details/${leadId}`).then(r => r.data),
  updateLeadAction: (leadId: string, payload: Record<string, unknown>) =>
    api.post(`/api/campaign/update-lead-action/${leadId}`, payload).then(r => r.data),
  campaignChat: (batchId: string, question: string, history: Array<{ role: string; content: string }> = []) =>
    api.post<{ answer: string }>('/api/campaign/campaign-chat', { batch_id: batchId, question, history }).then(r => r.data),
  callbackScript: (leadId: string, force = false) =>
    api.post<{ lead_id: string; callback_script: string; cached: boolean }>(`/api/campaign/callback-script/${leadId}`, null, { params: { force } }).then(r => r.data),
  redFlags: (batchId: string, unresolvedOnly = true) =>
    api.get<{ batch_id: string; total: number; flags: CampaignDashboardFlag[] }>(`/api/campaign/campaign-red-flags/${batchId}`, { params: { unresolved_only: unresolvedOnly } }).then(r => r.data),
  resolveFlag: (flagId: string, resolved = true) =>
    api.post(`/api/campaign/resolve-flag/${flagId}`, { resolved }).then(r => r.data),
  analytics: (batchId: string) =>
    api.get<CampaignDashboardAnalytics>(`/api/campaign/campaign-analytics/${batchId}`).then(r => r.data),
  triggerWorkflow: (batchId: string, webhookUrl?: string) =>
    api.post<{ status: string; batch_id: string; leads_sent: number }>('/api/campaign/trigger-workflow', {
      batch_id: batchId,
      webhook_url: webhookUrl,
    }).then(r => r.data),
  assignmentTable: (batchId: string, params?: { page?: number; limit?: number; priority_tier?: string; assigned?: string; agent_name?: string; search?: string; sort_by?: string; sort_dir?: string }) =>
    api.get<AssignmentTableResponse>(`/api/campaign/batch/${batchId}/assignment-table`, { params }).then(r => r.data),
  bulkAssign: (batchId: string, payload: BulkAssignPayload) =>
    api.post(`/api/campaign/batch/${batchId}/bulk-assign`, payload).then(r => r.data),
  autoAssign: (batchId: string) =>
    api.post(`/api/campaign/batch/${batchId}/auto-assign`).then(r => r.data),
}

export const projectsApi = {
  list: () => api.get<Project[]>('/api/projects').then(r => r.data),
  create: (payload: Record<string, unknown>) => api.post<Project>('/api/projects', payload).then(r => r.data),
  detail: (id: string) => api.get<ProjectDetail>(`/api/projects/${id}`).then(r => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<Project>(`/api/projects/${id}`, payload).then(r => r.data),
  addLeadTag: (projectId: string, leadId: string) => api.post(`/api/projects/${projectId}/leads/${leadId}`).then(r => r.data),
  removeLeadTag: (projectId: string, leadId: string) => api.delete(`/api/projects/${projectId}/leads/${leadId}`).then(r => r.data),
}

export default api
