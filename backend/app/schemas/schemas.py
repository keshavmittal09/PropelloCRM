from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr, Field


# ─── AUTH ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    # Plain str (not EmailStr): internal accounts like "krishna-group@propelloai"
    # have no dotted domain and would otherwise fail email validation. Login is an
    # exact match against the DB, so strict email formatting isn't needed here.
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    agent: "AgentResponse"

class AgentCreate(BaseModel):
    name: str
    email: str  # plain str so internal emails without a dotted domain are allowed
    password: str
    role: str = "agent"
    phone: Optional[str] = None


class AgentRoleUpdate(BaseModel):
    role: str

class AgentResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    phone: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ─── CONTACT ─────────────────────────────────────────────────────────────────

class ContactCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    type: str = "buyer"
    source: Optional[str] = None
    personal_notes: Optional[str] = None

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    type: Optional[str] = None
    personal_notes: Optional[str] = None
    assigned_to: Optional[str] = None

class ContactResponse(BaseModel):
    id: str
    name: str
    phone: str
    email: Optional[str]
    type: str
    source: Optional[str]
    personal_notes: Optional[str]
    assigned_to: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ─── PROPERTY ────────────────────────────────────────────────────────────────

class PropertyCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: str = "apartment"
    status: str = "available"
    transaction_type: str = "sale"
    price: Optional[float] = None
    area_sqft: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    address: Optional[str] = None
    city: Optional[str] = None
    locality: Optional[str] = None
    amenities: Optional[List[str]] = None
    media_urls: Optional[List[str]] = None

class PropertyUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    price: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    locality: Optional[str] = None

class PropertyResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    type: str
    status: str
    transaction_type: str
    price: Optional[float]
    area_sqft: Optional[float]
    bedrooms: Optional[int]
    bathrooms: Optional[int]
    address: Optional[str]
    city: Optional[str]
    locality: Optional[str]
    listed_by: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── LEAD ────────────────────────────────────────────────────────────────────

class InboundLead(BaseModel):
    """Received from Priya AI, website form, ads, portals — all external sources"""
    source: str
    name: str
    phone: str
    email: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    property_type: Optional[str] = None
    location_preference: Optional[str] = None
    timeline: Optional[str] = None
    lead_score: Optional[str] = "warm"
    transcript_summary: Optional[str] = None
    call_duration_seconds: Optional[int] = None
    personal_notes: Optional[str] = None

class LeadCreate(BaseModel):
    contact_id: Optional[str] = None
    # If contact_id not given, create contact from these:
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    source: str = "manual"
    lead_score: str = "warm"
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    property_type_interest: Optional[str] = None
    location_preference: Optional[str] = None
    timeline: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: str = "normal"

class LeadUpdate(BaseModel):
    lead_score: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    property_type_interest: Optional[str] = None
    location_preference: Optional[str] = None
    timeline: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    expected_close_date: Optional[datetime] = None
    personal_notes: Optional[str] = None  # Updates on the contact

class StageUpdate(BaseModel):
    stage: str
    lost_reason: Optional[str] = None  # Required when stage = lost

class NoteCreate(BaseModel):
    description: str

class CallLogCreate(BaseModel):
    outcome: str  # answered, voicemail, not_interested, callback_requested
    description: Optional[str] = None
    duration_seconds: Optional[int] = None

class LeadResponse(BaseModel):
    id: str
    contact_id: str
    source: str
    stage: str
    lead_score: str
    budget_min: Optional[float]
    budget_max: Optional[float]
    property_type_interest: Optional[str]
    location_preference: Optional[str]
    timeline: Optional[str]
    assigned_to: Optional[str]
    campaign_id: Optional[str] = None
    project_ids: Optional[list[str]] = None
    lost_reason: Optional[str]
    days_in_stage: int
    priority: str
    call_count: int
    last_contacted_at: Optional[datetime]
    priya_memory_brief: Optional[str]
    ai_analysis: Optional[Any] = None
    ai_analyzed_at: Optional[datetime] = None
    dnd: bool = False
    last_remark: Optional[str] = None
    last_interaction_at: Optional[datetime] = None
    # Demographic fields (mobile Feature 2 & 3)
    age_range: Optional[str] = None
    occupation: Optional[str] = None
    occupation_other: Optional[str] = None
    family_size: Optional[str] = None
    income_range: Optional[str] = None
    property_budget: Optional[str] = None
    preferred_location: Optional[str] = None
    purchase_timeline: Optional[str] = None
    last_call_status: Optional[str] = None
    last_call_topics: Optional[List[str]] = None
    last_call_interest: Optional[str] = None
    master_profile: Optional[Any] = None
    # AI Call Analysis fields
    call_score: Optional[int] = None
    call_sentiment: Optional[str] = None
    intent_level: Optional[str] = None
    interest_level: Optional[str] = None
    ai_recommended_action: Optional[str] = None
    last_call_transcript: Optional[str] = None
    last_call_summary: Optional[str] = None
    # WhatsApp & retry tracking
    whatsapp_status: str = "not_sent"
    retry_count: int = 0
    last_ai_call_date: Optional[datetime] = None
    next_call_date: Optional[datetime] = None
    max_retries_reached: bool = False
    next_followup_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    contact: Optional[ContactResponse] = None
    assigned_agent: Optional[AgentResponse] = None

    class Config:
        from_attributes = True

class InboundLeadResponse(BaseModel):
    lead_id: str
    contact_id: str
    is_returning_caller: bool
    lead_score: str
    assigned_to: Optional[str]


# ─── ACTIVITY ────────────────────────────────────────────────────────────────

class ActivityResponse(BaseModel):
    id: str
    lead_id: str
    type: str
    title: str
    description: Optional[str]
    outcome: Optional[str]
    campaign_id: Optional[str] = None
    recording_url: Optional[str] = None
    transcript: Optional[str] = None
    call_summary: Optional[str] = None
    call_eval_tag: Optional[str] = None
    performed_by: Optional[str]
    performed_at: datetime
    meta: Optional[Any]
    performed_by_agent: Optional[AgentResponse] = None

    class Config:
        from_attributes = True


# ─── TASK ────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    lead_id: str
    title: str
    description: Optional[str] = None
    task_type: str = "call"
    assigned_to: Optional[str] = None
    due_at: Optional[datetime] = None
    priority: str = "normal"

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    due_at: Optional[datetime] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None

class TaskResponse(BaseModel):
    id: str
    lead_id: str
    title: str
    description: Optional[str]
    task_type: str
    assigned_to: Optional[str]
    due_at: Optional[datetime]
    priority: str
    status: str
    completed_at: Optional[datetime]
    completion_remark: Optional[str] = None
    completion_tags: Optional[List[str]] = None
    completion_interest: Optional[str] = None
    remark_quality_score: Optional[float] = None
    remark_quality_feedback: Optional[str] = None
    created_at: datetime
    assigned_agent: Optional[AgentResponse] = None
    lead: Optional["LeadResponse"] = None

    class Config:
        from_attributes = True


# ─── SITE VISIT ──────────────────────────────────────────────────────────────

class SiteVisitCreate(BaseModel):
    lead_id: str
    property_id: Optional[str] = None
    scheduled_at: datetime
    agent_id: Optional[str] = None
    notes: Optional[str] = None

class SiteVisitUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    client_confirmed: Optional[bool] = None

class SiteVisitResponse(BaseModel):
    id: str
    lead_id: str
    property_id: Optional[str]
    scheduled_at: datetime
    agent_id: Optional[str]
    status: str
    client_confirmed: bool
    notes: Optional[str]
    created_at: datetime
    lead_contact_name: Optional[str] = None
    lead_contact_phone: Optional[str] = None
    agent_name: Optional[str] = None

    class Config:
        from_attributes = True


# ─── NOTIFICATION ────────────────────────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: str
    agent_id: str
    title: str
    body: Optional[str]
    type: str
    is_read: bool
    link: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── ANALYTICS ───────────────────────────────────────────────────────────────

class FunnelStage(BaseModel):
    stage: str
    count: int
    percentage: float

class SourceStat(BaseModel):
    source: str
    count: int
    won: int
    conversion_rate: float

class AgentStat(BaseModel):
    agent_id: str
    agent_name: str
    total_leads: int
    won: int
    tasks_done: int
    conversion_rate: float

class AnalyticsSummary(BaseModel):
    total_leads: int
    new_leads_today: int
    hot_leads: int
    won_this_month: int
    lost_this_month: int
    pipeline_value: float

class WhatsAppSend(BaseModel):
    template: str  # template key name
    lead_id: str
    custom_message: Optional[str] = None


class LeadNotifyRequest(BaseModel):
    channels: list[str] = Field(default_factory=lambda: ["whatsapp"])
    message: str = Field(min_length=1, max_length=2000)
    subject: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class AdminBroadcastRequest(BaseModel):
    channels: list[str] = Field(default_factory=lambda: ["in_app"])
    message: str = Field(min_length=1, max_length=2000)
    subject: Optional[str] = None
    target_agent_ids: list[str] = Field(default_factory=list)
    all_agents: bool = True

class MemoryResponse(BaseModel):
    phone: str
    is_returning_caller: bool
    contact: Optional[ContactResponse]
    lead: Optional[LeadResponse]
    priya_memory_brief: Optional[str]
    call_count: int


class CampaignRow(BaseModel):
    call_id: str = ""
    name: str = ""
    phone_number: str = ""
    transcript: str = ""
    recording_url: str = ""
    extracted_entities: str = ""
    call_eval_tag: str = ""
    summary: str = ""
    # Extended fields from campaign Excel schema (optional for backward compatibility)
    other_info: str = ""
    attempt_number: Optional[int] = 1
    call_conversation_quality: str = ""
    call_dialing_at: Optional[str] = None
    call_ringing_at: Optional[str] = None
    user_picked_up: Optional[str] = None
    num_of_retries: Optional[int] = 0
    dial_status_reason: str = ""


class CampaignUploadPreview(BaseModel):
    rows: list[CampaignRow]
    total: int
    format_detected: str


class CampaignIngestRequest(BaseModel):
    campaign_name: str
    agent_name: str = "Niharika"
    rows: list[CampaignRow]


class CampaignLeadSummary(BaseModel):
    lead_id: str
    name: str
    phone: str
    score: str
    stage: str
    priority: str
    priority_tier: Optional[str] = None
    priority_score: Optional[int] = None
    summary: Optional[str] = None
    action: str


class CampaignIngestResult(BaseModel):
    campaign_id: str
    total: int
    hot: int
    warm: int
    cold: int
    created: int
    updated: int
    skipped_duplicates: int = 0
    failed_rows: int = 0
    tier_distribution: dict[str, int] = Field(default_factory=dict)
    leads: list[CampaignLeadSummary]


class CampaignResponse(BaseModel):
    id: str
    name: str
    project_id: Optional[str]
    agent_name: Optional[str]
    total_calls: int
    hot_count: int
    warm_count: int
    cold_count: int
    new_leads_created: int
    existing_leads_updated: int
    skipped_duplicates: int = 0
    failed_rows: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class ProjectResponse(BaseModel):
    id: str
    name: str
    developer: Optional[str]
    location: Optional[str]
    city: Optional[str]
    bhk_options: Optional[list[str]] = None
    price_range_min: Optional[float]
    price_range_max: Optional[float]
    brochure_url: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class CampaignDetailResponse(CampaignResponse):
    project_name: Optional[str] = None
    leads: list[LeadResponse] = Field(default_factory=list)


class CampaignAttemptStat(BaseModel):
    attempt: int
    total: int
    connected: int
    rate: float


class CampaignInsight(BaseModel):
    id: str
    title: str
    description: str
    severity: str
    metric_value: str
    recommendation: str


class CampaignTranscriptBucket(BaseModel):
    bucket: str
    count: int
    avg_quality: float


class CampaignAnalyticsResponse(BaseModel):
    campaign_id: str
    campaign_name: str
    total_dialed: int
    total_connected: int
    connection_rate: float
    eval_yes: int
    eval_no: int
    eval_empty: int
    avg_clarity: float
    avg_professionalism: float
    avg_problem_resolution: float
    avg_overall_quality: float
    attempt_stats: list[CampaignAttemptStat] = Field(default_factory=list)
    tier_distribution: dict[str, int] = Field(default_factory=dict)
    hot_count: int
    warm_count: int
    cold_count: int
    insights: list[CampaignInsight] = Field(default_factory=list)
    transcript_length_buckets: list[CampaignTranscriptBucket] = Field(default_factory=list)


class CampaignLeadDetailResponse(BaseModel):
    lead_id: str
    name: str
    phone: str
    priority_tier: str
    priority_score: int
    lead_score: str
    stage: str
    attempt_number: int = 1
    call_eval_tag: str = ""
    summary: str = ""
    transcript: str = ""
    recording_url: str = ""
    extracted_entities: dict[str, Any] = Field(default_factory=dict)
    call_quality: dict[str, Any] = Field(default_factory=dict)
    call_dialing_at: Optional[str] = None
    user_picked_up: Optional[str] = None
    num_of_retries: int = 0
    ai_analysis: Optional[Any] = None
    assigned_agent_name: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    action: str


class AgentAssignment(BaseModel):
    agent_id: str
    agent_name: str
    lead_count: int
    tier_breakdown: dict[str, int] = Field(default_factory=dict)
    leads: list[CampaignLeadDetailResponse] = Field(default_factory=list)


# ─── TASK COMPLETION WITH REMARK (Feature 1 & 2) ────────────────────────────

class TaskCompleteWithRemarkRequest(BaseModel):
    remark_text: str = Field(min_length=80, max_length=5000)
    preset_tags: list[str] = Field(default_factory=list)
    # ─── Optional demographic fields (mobile Feature 2) ────────────────────────
    call_status: Optional[str] = Field(None, description="One of: connected, no_answer, wrong_number, callback")
    interest_level: Optional[str] = Field(None, description="hot, warm, cold, unknown")
    topics_discussed: Optional[list[str]] = Field(default_factory=list)
    demographics: Optional[DemographicsInput] = None
    next_followup_at: Optional[datetime] = None
    # Override remark_text with demographic note when no free text
    note: Optional[str] = Field(None, max_length=200)


class DNCFlagRequest(BaseModel):
    lead_id: str
    mark_dnd: bool = True


# ─── MASTER PROFILE (Feature 3) ─────────────────────────────────────────────

class MasterProfileUpdate(BaseModel):
    """Manual fields that an agent can edit on the master profile."""
    # AI fields can be overridden manually when needed.
    config_preference: Optional[str] = None
    budget_range: Optional[str] = None
    site_visit_intent: Optional[str] = None
    primary_language: Optional[str] = None
    objection_type: Optional[str] = None
    intent_level: Optional[str] = None
    ai_summary: Optional[str] = None
    key_quote: Optional[str] = None

    full_name: Optional[str] = None
    email: Optional[str] = None
    alternate_phone: Optional[str] = None
    city: Optional[str] = None
    locality: Optional[str] = None
    occupation: Optional[str] = None
    family_size: Optional[int] = None
    current_living_situation: Optional[str] = None
    investment_purpose: Optional[str] = None
    source: Optional[str] = None
    agent_notes: Optional[str] = None
    priority_override: Optional[str] = None
    priority_override_reason: Optional[str] = None


class MasterProfileResponse(BaseModel):
    # Auto-populated from AI
    config_preference: Optional[str] = None
    budget_range: Optional[str] = None
    site_visit_intent: Optional[str] = None
    primary_language: Optional[str] = None
    objection_type: Optional[str] = None
    intent_level: Optional[str] = None
    ai_summary: Optional[str] = None
    key_quote: Optional[str] = None
    # Manual
    full_name: Optional[str] = None
    email: Optional[str] = None
    alternate_phone: Optional[str] = None
    city: Optional[str] = None
    locality: Optional[str] = None
    occupation: Optional[str] = None
    family_size: Optional[int] = None
    current_living_situation: Optional[str] = None
    investment_purpose: Optional[str] = None
    source: Optional[str] = None
    agent_notes: Optional[str] = None
    priority_override: Optional[str] = None
    priority_override_reason: Optional[str] = None
    # Computed
    total_calls: int = 0
    first_contact_date: Optional[str] = None
    last_contact_date: Optional[str] = None
    days_in_pipeline: int = 0
    completion_rate: float = 0.0


# ─── BULK ASSIGNMENT (Feature 4) ────────────────────────────────────────────

class BulkAssignPayload(BaseModel):
    lead_ids: list[str] = Field(min_length=1)
    agent_id: str
    reason: Optional[str] = None  # Required for reassignments (min 20 chars)


class BulkAssignRequest(BaseModel):
    lead_ids: list[str] = Field(min_length=1)
    agent_id: str
    reason: Optional[str] = None


class AssignmentTableLead(BaseModel):
    id: str
    name: Optional[str] = None
    phone: Optional[str] = None
    priority_tier: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    assigned_agent_name: Optional[str] = None
    status: Optional[str] = None
    last_contact: Optional[str] = None

    class Config:
        from_attributes = True


# ─── AGENT PERFORMANCE (Features 5 & 6) ─────────────────────────────────────

class AgentPerformanceResponse(BaseModel):
    agent_id: str
    agent_name: str
    role: str
    star_rating: Optional[int]
    performance_score: float
    completion_rate: float
    conversion_rate: float
    avg_remark_quality: float
    tasks_completed_30d: int
    leads_converted_30d: int
    rating_set_by: Optional[str]
    rating_set_by_name: Optional[str]
    rating_set_at: Optional[str]
    trend_data: List[dict]


class LeaderboardEntry(BaseModel):
    agent_id: str
    agent_name: str
    role: str
    star_rating: Optional[int]
    performance_score: float
    completion_rate: float
    conversion_rate: float
    active_lead_count: int
    is_active: bool

    class Config:
        from_attributes = True


# ─── DEMOGRAPHIC PROFILE (Mobile Feature 2 & 3) ────────────────────────────────

class DemographicsInput(BaseModel):
    age_range: Optional[str] = None
    occupation: Optional[str] = None
    occupation_other: Optional[str] = None
    family_size: Optional[str] = None
    income_range: Optional[str] = None
    property_budget: Optional[str] = None
    preferred_location: Optional[str] = None
    purchase_timeline: Optional[str] = None
    current_living_situation: Optional[str] = None
    investment_purpose: Optional[str] = None


class TaskCompleteDemographicRequest(BaseModel):
    call_status: str = Field(..., description="One of: connected, no_answer, wrong_number, callback")
    interest_level: Optional[str] = Field(None, description="One of: hot, warm, cold, unknown")
    topics_discussed: Optional[List[str]] = Field(default_factory=list)
    demographics: Optional[DemographicsInput] = None
    next_followup_at: Optional[datetime] = None
    note: Optional[str] = Field(None, max_length=200)


class DemographicsResponse(BaseModel):
    age_range: Optional[str] = None
    occupation: Optional[str] = None
    occupation_other: Optional[str] = None
    family_size: Optional[str] = None
    income_range: Optional[str] = None
    property_budget: Optional[str] = None
    preferred_location: Optional[str] = None
    purchase_timeline: Optional[str] = None
    last_call_status: Optional[str] = None
    last_call_topics: Optional[List[str]] = None
    last_call_interest: Optional[str] = None


class TaskCompleteDemographicResponse(BaseModel):
    task_id: str
    lead_id: str
    updated_fields: List[str]
    next_followup_id: Optional[str] = None

