from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr, Field


# ─── AUTH ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    agent: "AgentResponse"

class AgentCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "agent"
    phone: Optional[str] = None

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
