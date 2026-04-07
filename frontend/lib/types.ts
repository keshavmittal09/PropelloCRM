export type Role = 'admin' | 'manager' | 'agent'
export type LeadStage = 'new' | 'contacted' | 'site_visit_scheduled' | 'site_visit_done' | 'negotiation' | 'won' | 'lost' | 'nurture'
export type LeadScore = 'hot' | 'warm' | 'cold'
export type LeadSource = 'priya_ai' | 'website' | 'facebook_ads' | 'google_ads' | '99acres' | 'magicbricks' | 'walk_in' | 'referral' | 'email_campaign' | 'manual'
export type TaskStatus = 'pending' | 'done' | 'overdue' | 'cancelled'
export type ActivityType = 'call' | 'whatsapp' | 'email' | 'site_visit' | 'note' | 'stage_change' | 'priya_call' | 'property_shown' | 'task_completed' | 'lead_created'

export interface Agent {
  id: string
  name: string
  email: string
  role: Role
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface Contact {
  id: string
  name: string
  phone: string
  email: string | null
  type: string
  source: string | null
  personal_notes: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface Lead {
  id: string
  contact_id: string
  source: LeadSource
  stage: LeadStage
  lead_score: LeadScore
  budget_min: number | null
  budget_max: number | null
  property_type_interest: string | null
  location_preference: string | null
  timeline: string | null
  assigned_to: string | null
  lost_reason: string | null
  days_in_stage: number
  priority: string
  call_count: number
  last_contacted_at: string | null
  priya_memory_brief: string | null
  created_at: string
  updated_at: string
  contact?: Contact
  assigned_agent?: Agent
}

export interface Activity {
  id: string
  lead_id: string
  type: ActivityType
  title: string
  description: string | null
  outcome: string | null
  performed_by: string | null
  performed_at: string
  meta: Record<string, unknown> | null
  performed_by_agent?: Agent
}

export interface Task {
  id: string
  lead_id: string
  title: string
  description: string | null
  task_type: string
  assigned_to: string | null
  due_at: string | null
  priority: string
  status: TaskStatus
  completed_at: string | null
  created_at: string
  assigned_agent?: Agent
  lead?: Lead
}

export interface Property {
  id: string
  title: string
  description: string | null
  type: string
  status: string
  transaction_type: string
  price: number | null
  area_sqft: number | null
  bedrooms: number | null
  bathrooms: number | null
  address: string | null
  city: string | null
  locality: string | null
  listed_by: string | null
  created_at: string
}

export interface SiteVisit {
  id: string
  lead_id: string
  property_id: string | null
  scheduled_at: string
  agent_id: string | null
  status: string
  client_confirmed: boolean
  notes: string | null
  created_at: string
  lead_contact_name?: string | null
  lead_contact_phone?: string | null
  agent_name?: string | null
}

export interface Notification {
  id: string
  agent_id: string
  title: string
  body: string | null
  type: string
  is_read: boolean
  link: string | null
  created_at: string
}

export interface AnalyticsSummary {
  total_leads: number
  new_leads_today: number
  hot_leads: number
  won_this_month: number
  lost_this_month: number
  pipeline_value: number
}

export interface FunnelStage {
  stage: string
  count: number
  percentage: number
}

export interface SourceStat {
  source: string
  count: number
  won: number
  conversion_rate: number
}

export interface AgentStat {
  agent_id: string
  agent_name: string
  total_leads: number
  won: number
  tasks_done: number
  conversion_rate: number
}

export interface KanbanBoard {
  new: Lead[]
  contacted: Lead[]
  site_visit_scheduled: Lead[]
  site_visit_done: Lead[]
  negotiation: Lead[]
  won: Lead[]
  lost: Lead[]
  nurture: Lead[]
}

export interface TokenResponse {
  access_token: string
  token_type: string
  agent: Agent
}
