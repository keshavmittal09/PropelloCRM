import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Enum as SAEnum, Text, Numeric, Integer, ForeignKey, Date, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_id: Mapped[str] = mapped_column(String, ForeignKey("contacts.id"), index=True)
    source: Mapped[str] = mapped_column(
        SAEnum("priya_ai", "website", "facebook_ads", "google_ads",
               "99acres", "magicbricks", "walk_in", "referral",
               "email_campaign", "manual", "campaign", name="lead_source"),
        default="manual"
    )
    stage: Mapped[str] = mapped_column(
        SAEnum("new", "contacted", "site_visit_scheduled", "site_visit_done",
               "negotiation", "won", "lost", "nurture", name="lead_stage"),
        default="new", index=True
    )
    lead_score: Mapped[str] = mapped_column(
        SAEnum("hot", "warm", "cold", name="lead_score_enum"),
        default="warm"
    )
    budget_min: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    budget_max: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    property_type_interest: Mapped[str | None] = mapped_column(String(50), nullable=True)
    location_preference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    timeline: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True, index=True)
    campaign_id: Mapped[str | None] = mapped_column(String, ForeignKey("campaigns.id"), nullable=True, index=True)
    project_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    interested_properties: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of property IDs
    lost_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    days_in_stage: Mapped[int] = mapped_column(Integer, default=0)
    priority: Mapped[str] = mapped_column(
        SAEnum("P1", "P2", "P3", "P4", "P5", "high", "normal", "low", name="lead_priority"),
        default="P3"
    )
    expected_close_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    priya_memory_brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_count: Mapped[int] = mapped_column(Integer, default=0)
    ai_analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dnd: Mapped[bool] = mapped_column(Boolean, default=False)
    last_remark: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_interaction_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Demographic profile fields (enriched via task completion form)
    age_range: Mapped[str | None] = mapped_column(String(20), nullable=True)
    occupation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    occupation_other: Mapped[str | None] = mapped_column(String(100), nullable=True)
    family_size: Mapped[str | None] = mapped_column(String(10), nullable=True)
    income_range: Mapped[str | None] = mapped_column(String(30), nullable=True)
    property_budget: Mapped[str | None] = mapped_column(String(30), nullable=True)
    preferred_location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    purchase_timeline: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Call quality fields (updated on each task completion)
    last_call_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_call_topics: Mapped[list | None] = mapped_column(JSON, nullable=True)
    last_call_interest: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # AI Call Analysis fields (stored after each AI call analysis)
    call_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-100 numeric score
    call_sentiment: Mapped[str | None] = mapped_column(String(20), nullable=True)  # positive/neutral/negative
    intent_level: Mapped[str | None] = mapped_column(String(20), nullable=True)  # high/medium/low
    interest_level: Mapped[str | None] = mapped_column(String(20), nullable=True)  # high/medium/low
    ai_recommended_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_call_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_call_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # WhatsApp tracking
    whatsapp_status: Mapped[str] = mapped_column(String(20), default="not_sent")  # not_sent/sent/delivered/read/replied
    # Cold lead retry tracking
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    last_ai_call_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_call_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    max_retries_reached: Mapped[bool] = mapped_column(Boolean, default=False)
    next_followup_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Legacy/computed fields
    master_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    stage_changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    contact = relationship("Contact", back_populates="leads")
    assigned_agent = relationship("Agent", back_populates="leads", foreign_keys=[assigned_to])
    activities = relationship("Activity", back_populates="lead", order_by="Activity.performed_at.desc()")
    tasks = relationship("Task", back_populates="lead")
    site_visits = relationship("SiteVisit", back_populates="lead")
    campaign = relationship("Campaign", back_populates="leads")
