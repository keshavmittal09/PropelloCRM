export type Role = 'admin' | 'manager' | 'agent' | 'call_agent' | 'reception'
export type LeadStage = 'new' | 'contacted' | 'site_visit_scheduled' | 'site_visit_done' | 'negotiation' | 'won' | 'lost' | 'nurture'
export type LeadScore = 'hot' | 'warm' | 'cold'
export type LeadSource = 'priya_ai' | 'website' | 'facebook_ads' | 'google_ads' | '99acres' | 'magicbricks' | 'walk_in' | 'referral' | 'email_campaign' | 'manual' | 'campaign'
export type TaskStatus = 'pending' | 'done' | 'overdue' | 'cancelled'
export type ActivityType = 'call' | 'whatsapp' | 'email' | 'site_visit' | 'note' | 'stage_change' | 'priya_call' | 'property_shown' | 'task_completed' | 'lead_created' | 'campaign_call' | 'task_completion_remark' | 'ai_call_completed' | 'ai_analysis_generated' | 'classified' | 'retry_scheduled' | 'whatsapp_auto_sent' | 'assignment_update' | 'priority_change'
export type CallSentiment = 'positive' | 'neutral' | 'negative'
export type IntentLevel = 'high' | 'medium' | 'low'
export type WhatsAppStatus = 'not_sent' | 'sent' | 'delivered' | 'read' | 'replied'

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
  campaign_id: string | null
  project_ids: string[] | null
  lost_reason: string | null
  days_in_stage: number
  priority: string
  call_count: number
  last_contacted_at: string | null
  priya_memory_brief: string | null
  created_at: string
  updated_at: string
  dnd?: boolean
  last_remark?: string | null
  last_interaction_at?: string | null
  // Demographic fields
  age_range?: string | null
  occupation?: string | null
  occupation_other?: string | null
  family_size?: string | null
  income_range?: string | null
  property_budget?: string | null
  preferred_location?: string | null
  purchase_timeline?: string | null
  last_call_status?: string | null
  last_call_topics?: string[] | null
  last_call_interest?: string | null
  master_profile?: Record<string, unknown> | null
  // AI Call Analysis fields
  call_score?: number | null
  call_sentiment?: CallSentiment | null
  intent_level?: IntentLevel | null
  interest_level?: IntentLevel | null
  ai_recommended_action?: string | null
  last_call_transcript?: string | null
  last_call_summary?: string | null
  // WhatsApp & retry tracking
  whatsapp_status?: WhatsAppStatus
  retry_count?: number
  last_ai_call_date?: string | null
  next_call_date?: string | null
  max_retries_reached?: boolean
  next_followup_date?: string | null
  contact?: Contact
  assigned_agent?: Agent
}

export interface LeadPaginatedResponse {
  items: Lead[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface Activity {
  id: string
  lead_id: string
  type: ActivityType
  campaign_id: string | null
  title: string
  description: string | null
  outcome: string | null
  recording_url: string | null
  transcript: string | null
  call_summary: string | null
  call_eval_tag: string | null
  performed_by: string | null
  performed_at: string
  meta: Record<string, unknown> | null
  performed_by_agent?: Agent
}

export interface AICall {
  id: string
  title: string
  description: string | null
  recording_url: string | null
  transcript: string | null
  call_summary: string | null
  performed_at: string
  lead_id: string
  lead_name: string | null
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
  completion_remark?: string | null
  completion_tags?: string[] | null
  remark_quality_score?: number | null
  remark_quality_feedback?: string | null
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

export interface LeadNotifyPayload {
  channels: Array<'whatsapp' | 'email'>
  message: string
  subject?: string | null
  scheduled_at?: string | null
}

export interface AdminBroadcastPayload {
  channels: Array<'in_app' | 'whatsapp' | 'email'>
  message: string
  subject?: string | null
  target_agent_ids?: string[]
  all_agents?: boolean
}

export interface AnalyticsSummary {
  total_leads: number
  new_leads_today: number
  hot_leads: number
  warm_leads: number
  cold_leads: number
  callback_leads: number
  assigned_leads: number
  won_this_month: number
  lost_this_month: number
  converted_leads: number
  pipeline_value: number
  ai_calls_completed: number
  whatsapp_sent: number
  conversion_rate: number
  pending_tasks: number
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

export interface MetaMarketingStats {
  spend: number
  impressions: number
  clicks: number
  cpc: number
  ctr: number
  days: number
}

export interface MetaCampaignStat {
  id: string
  name: string
  status: string
  spend: number
  impressions: number
  clicks: number
  cpc: number
  leads: number
  cpl: number
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

export interface Campaign {
  id: string
  name: string
  agent_name: string
  project_id: string | null
  total_calls: number
  hot_count: number
  warm_count: number
  cold_count: number
  new_leads_created: number
  existing_leads_updated: number
  skipped_duplicates: number
  failed_rows: number
  created_at: string
}

export interface CampaignRow {
  call_id: string
  name: string
  phone_number: string
  transcript: string
  recording_url: string
  extracted_entities: string
  call_eval_tag: string
  summary: string
  other_info?: string
  attempt_number?: number
  call_conversation_quality?: string
  call_dialing_at?: string | null
  call_ringing_at?: string | null
  user_picked_up?: string | null
  num_of_retries?: number
  dial_status_reason?: string
}

export interface CampaignAttemptStat {
  attempt: number
  total: number
  connected: number
  rate: number
}

export interface CampaignInsight {
  id: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  metric_value: string
  recommendation: string
}

export interface CampaignTranscriptBucket {
  bucket: string
  count: number
  avg_quality: number
}

export interface CampaignAnalytics {
  campaign_id: string
  campaign_name: string
  total_dialed: number
  total_connected: number
  connection_rate: number
  eval_yes: number
  eval_no: number
  eval_empty: number
  avg_clarity: number
  avg_professionalism: number
  avg_problem_resolution: number
  avg_overall_quality: number
  attempt_stats: CampaignAttemptStat[]
  tier_distribution: Record<string, number>
  hot_count: number
  warm_count: number
  cold_count: number
  insights: CampaignInsight[]
  transcript_length_buckets: CampaignTranscriptBucket[]
}

export interface CampaignLeadDetail {
  lead_id: string
  name: string
  phone: string
  priority_tier: string
  priority_score: number
  lead_score: LeadScore
  stage: LeadStage | string
  attempt_number: number
  call_eval_tag: string
  summary: string
  transcript: string
  recording_url: string
  extracted_entities: Record<string, unknown>
  call_quality: {
    clarity?: number
    professionalism?: number
    problem_resolution?: number
    overall_quality?: number
    [key: string]: unknown
  }
  call_dialing_at: string | null
  user_picked_up: string | null
  num_of_retries: number
  ai_analysis: Record<string, unknown> | null
  assigned_agent_name: string | null
  assigned_agent_id?: string | null
  action: 'created' | 'updated' | string
}

export interface AgentAssignment {
  agent_id: string
  agent_name: string
  lead_count: number
  tier_breakdown: Record<string, number>
  leads: CampaignLeadDetail[]
}

export interface CampaignPreview {
  rows: CampaignRow[]
  total: number
  format_detected: 'csv' | 'json' | 'xlsx' | 'xls'
}

export interface CampaignIngestPayload {
  campaign_name: string
  agent_name: string
  rows: CampaignRow[]
}

export interface CampaignLeadSummary {
  lead_id: string
  name: string
  phone: string
  score: LeadScore
  stage: LeadStage
  priority: 'high' | 'normal' | 'low'
  summary: string | null
  action: 'created' | 'updated'
}

export interface CampaignResult {
  campaign_id: string
  total: number
  hot: number
  warm: number
  cold: number
  created: number
  updated: number
  skipped_duplicates: number
  failed_rows: number
  tier_distribution: Record<string, number>
  leads: CampaignLeadSummary[]
}

export interface CampaignDetail extends Campaign {
  project_name: string | null
  leads: Lead[]
}

export interface Project {
  id: string
  name: string
  developer: string | null
  location: string | null
  city: string | null
  bhk_options: string[] | null
  price_range_min: number | null
  price_range_max: number | null
  brochure_url: string | null
  status: 'active' | 'completed' | 'upcoming'
  created_at: string
}

export interface ProjectDetail {
  project: Project
  leads: Lead[]
}

export interface CampaignDashboardBatch {
  id: string
  name: string
  file_name?: string | null
  analysis_status: string
  total_leads: number
  campaign_health_score?: number | null
  campaign_health_label?: string | null
  conversion_rate?: number | null
  created_at?: string | null
}

export interface CampaignDashboardProgress {
  status: string
  message?: string | null
  progress_pct?: number
  processed?: number
  total?: number
  error?: string | null
}

export interface CampaignDashboardLead {
  id: string
  batch_id?: string
  name: string | null
  phone_number: string | null
  attempt_number: number | null
  call_id?: string | null
  transcript?: string | null
  recording_url?: string | null
  extracted_entities?: Record<string, unknown> | null
  call_eval_tag: string | null
  summary: string | null
  call_conversation_quality?: Record<string, unknown> | null
  call_dialing_at?: string | null
  call_ringing_at?: string | null
  user_picked_up?: string | null
  num_of_retries?: number | null
  priority_tier: string | null
  lead_score: number | null
  intent_level?: string | null
  engagement_quality?: string | null
  drop_reason?: string | null
  objection_type?: string | null
  objection_handleable?: boolean | null
  recommended_action?: string | null
  callback_urgency_hours?: number | null
  config_interest?: string | null
  budget_signal?: string | null
  language_preference?: string | null
  pitch_reached?: boolean | null
  closing_attempted?: boolean | null
  whatsapp_number_captured?: boolean | null
  site_visit_committed?: boolean | null
  site_visit_timeframe?: string | null
  ai_detected_by_user?: boolean | null
  audio_quality_issue?: string | null
  audio_loop_detected?: boolean | null
  script_issue_detected?: string | null
  retry_time_recommendation?: string | null
  enriched_summary?: string | null
  key_quote?: string | null
  sales_coach_note?: string | null
  transcript_depth?: string | null
  user_engagement_ratio?: number | null
  assigned_agent?: string | null
  whatsapp_sent?: boolean | null
  dnd_flag?: boolean | null
  action_taken?: string | null
  callback_script?: string | null
  notes?: string | null
  updated_at?: string | null
}

export interface CampaignDashboardResults {
  batch: CampaignDashboardBatch & {
    p1_count?: number
    p2_count?: number
    p3_count?: number
    p4_count?: number
    p5_count?: number
    avg_quality_score?: number | null
    insights?: Record<string, unknown> | null
  }
  pagination: {
    page: number
    limit: number
    total: number
    total_pages: number
  }
  leads: CampaignDashboardLead[]
}

export interface CampaignDashboardLeadDetails {
  batch: {
    id: string | null
    name: string | null
    status: string | null
  }
  lead: CampaignDashboardLead
  history: Array<{
    id: string
    attempt_number: number | null
    priority_tier: string | null
    lead_score: number | null
    drop_reason: string | null
    summary: string | null
    call_dialing_at: string | null
  }>
}

export interface CampaignDashboardFlag {
  id: string
  lead_id: string | null
  flag_type: string
  description: string
  resolved: boolean
  created_at: string | null
}

export interface CampaignDashboardAnalytics {
  batch: {
    id: string
    name: string
    total_leads: number
    p1_count?: number
    p2_count?: number
    p3_count?: number
    p4_count?: number
    p5_count?: number
    avg_quality_score?: number | null
    conversion_rate?: number | null
    campaign_health_score?: number | null
    campaign_health_label?: string | null
  }
  distribution: {
    by_hour: Record<string, number>
    by_objection: Record<string, number>
    by_drop_reason: Record<string, number>
  }
  insights: Record<string, unknown> | null
}

// ─── TASK COMPLETION REMARK (Feature 1+2) ──────────────────────────────────
export interface TaskCompleteWithRemarkPayload {
  remark_text: string
  preset_tags: string[]
  call_status?: string
  interest_level?: string
  topics_discussed?: string[]
  demographics?: DemographicsInput | null
  next_followup_at?: string | null
  note?: string | null
}

export interface DNCFlagPayload {
  lead_id: string
  mark_dnd: boolean
}

// ─── MASTER PROFILE (Feature 3) ────────────────────────────────────────────
export interface MasterProfile {
  // AI-populated
  config_preference?: string | null
  budget_range?: string | null
  site_visit_intent?: string | null
  primary_language?: string | null
  objection_type?: string | null
  intent_level?: string | null
  ai_summary?: string | null
  key_quote?: string | null
  // Manual
  full_name?: string | null
  email?: string | null
  alternate_phone?: string | null
  city?: string | null
  locality?: string | null
  occupation?: string | null
  occupation_other?: string | null
  family_size?: number | null
  current_living_situation?: string | null
  investment_purpose?: string | null
  source?: string | null
  agent_notes?: string | null
  priority_override?: string | null
  priority_override_reason?: string | null
  // Computed
  total_calls?: number
  first_contact_date?: string | null
  last_contact_date?: string | null
  days_in_pipeline?: number
  completion_rate?: number
  // Demographic fields (synced from task completion)
  age_range?: string | null
  income_range?: string | null
  property_budget?: string | null
  preferred_location?: string | null
  purchase_timeline?: string | null
  // Call quality fields
  last_call_status?: string | null
  last_call_interest?: string | null
  last_call_topics?: string[] | null
}

// ─── ASSIGNMENT TABLE (Feature 4) ──────────────────────────────────────────
export interface AssignmentTableLead {
  id: string
  name: string | null
  phone_number: number | null
  priority_tier: string | null
  lead_score: number | null
  assigned_agent: string | null
  intent_level: string | null
  dnd_flag: boolean | null
  action_taken: string | null
  updated_at: string | null
}

export interface AssignmentTableResponse {
  total: number
  page: number
  limit: number
  total_pages: number
  leads: AssignmentTableLead[]
}

export interface BulkAssignPayload {
  lead_ids: string[]
  agent_id: string
  reason?: string
}

// ─── AGENT PERFORMANCE & LEADERBOARD (Feature 5 & 6) ───────────────────────
export interface LeaderboardEntry {
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

export interface AgentPerformanceResponse {
  agent_id: string
  agent_name: string
  role: Role
  star_rating: number | null
  performance_score: number
  completion_rate: number
  conversion_rate: number
  avg_remark_quality: number
  tasks_completed_30d: number
  leads_converted_30d: number
  rating_set_by: string | null
  rating_set_by_name: string | null
  rating_set_at: string | null
  trend_data: Array<{
    date: string
    performance_score: number
    completion_rate: number
    conversion_rate: number
  }>
}

// ─── DEMOGRAPHIC PROFILE (Mobile Feature 2 & 3) ────────────────────────────
export interface DemographicsProfile {
  age_range: string | null
  occupation: string | null
  occupation_other: string | null
  family_size: string | null
  income_range: string | null
  property_budget: string | null
  preferred_location: string | null
  purchase_timeline: string | null
  last_call_status: string | null
  last_call_topics: string[] | null
  last_call_interest: string | null
}

export interface DemographicsInput {
  age_range?: string | null
  occupation?: string | null
  occupation_other?: string | null
  family_size?: string | null
  income_range?: string | null
  property_budget?: string | null
  preferred_location?: string | null
  purchase_timeline?: string | null
  current_living_situation?: string | null
  investment_purpose?: string | null
}

export interface TaskCompleteDemographicPayload {
  call_status: 'connected' | 'no_answer' | 'wrong_number' | 'callback'
  interest_level?: 'hot' | 'warm' | 'cold' | 'unknown' | null
  topics_discussed?: string[]
  demographics?: DemographicsInput | null
  next_followup_at?: string | null
  note?: string | null
}

export interface TaskCompleteDemographicResult {
  task_id: string
  lead_id: string
  updated_fields: string[]
  next_followup_id: string | null
}
