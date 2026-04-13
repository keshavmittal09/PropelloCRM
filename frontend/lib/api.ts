import axios from 'axios'
import type {
  Agent, Lead, Contact, Property, Task, Activity,
  SiteVisit, Notification, AnalyticsSummary, FunnelStage,
  SourceStat, AgentStat, KanbanBoard, TokenResponse,
  Campaign, CampaignDetail, CampaignIngestPayload, CampaignPreview, CampaignResult, Project, ProjectDetail
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

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('propello_token')
      localStorage.removeItem('propello_agent')
      window.location.href = '/login'
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
  deleteAgent: (id: string) => api.delete(`/api/auth/agents/${id}`).then(r => r.data),
}

// ─── LEADS ───────────────────────────────────────────────────────────────────
export const leadsApi = {
  list: (params?: { stage?: string; source?: string; lead_score?: string; assigned_to?: string; search?: string; skip?: number; limit?: number }) =>
    api.get<Lead[]>('/api/leads', { params }).then(r => r.data),
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
  propertyMatches: (id: string) => api.get<Property[]>(`/api/leads/${id}/property-matches`).then(r => r.data),
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
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: () => api.get<Notification[]>('/api/notifications').then(r => r.data),
  readAll: () => api.patch('/api/notifications/read-all').then(r => r.data),
}

// ─── CAMPAIGNS ─────────────────────────────────────────────────────────────
export const campaignsApi = {
  uploadCampaignPreview: (file: File, campaignName: string, agentName = 'Niharika') => {
    const form = new FormData()
    form.append('file', file)
    form.append('campaign_name', campaignName)
    form.append('agent_name', agentName)
    return api.post<CampaignPreview>('/api/campaigns/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  ingestCampaign: (payload: CampaignIngestPayload) =>
    api.post<CampaignResult>('/api/campaigns/ingest', payload).then(r => r.data),
  getCampaigns: (skip = 0, limit = 50) =>
    api.get<Campaign[]>('/api/campaigns', { params: { skip, limit } }).then(r => r.data),
  getCampaign: (id: string) =>
    api.get<CampaignDetail>(`/api/campaigns/${id}`).then(r => r.data),
  listProjects: () =>
    api.get<Project[]>('/api/campaigns/projects').then(r => r.data),
  assignProject: (campaignId: string, projectId: string) =>
    api.patch(`/api/campaigns/${campaignId}/project/${projectId}`).then(r => r.data),
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
