import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


class CampaignBatch(Base):
    __tablename__ = "campaign_batches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), index=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    upload_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    total_leads: Mapped[int] = mapped_column(Integer, default=0)

    p1_count: Mapped[int] = mapped_column(Integer, default=0)
    p2_count: Mapped[int] = mapped_column(Integer, default=0)
    p3_count: Mapped[int] = mapped_column(Integer, default=0)
    p4_count: Mapped[int] = mapped_column(Integer, default=0)
    p5_count: Mapped[int] = mapped_column(Integer, default=0)

    avg_quality_score: Mapped[float] = mapped_column(Float, default=0)
    conversion_rate: Mapped[float] = mapped_column(Float, default=0)
    campaign_health_score: Mapped[int] = mapped_column(Integer, default=0)
    campaign_health_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_insights: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    analysis_status: Mapped[str] = mapped_column(String(32), default="processing")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    leads = relationship("CampaignLead", back_populates="batch", cascade="all, delete-orphan")
    flags = relationship("CampaignFlag", back_populates="batch", cascade="all, delete-orphan")


class CampaignLead(Base):
    __tablename__ = "campaign_leads"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    batch_id: Mapped[str] = mapped_column(String, ForeignKey("campaign_batches.id"), index=True)

    # Raw input fields
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    attempt_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    call_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    recording_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_entities: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    call_eval_tag: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_conversation_quality: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    call_dialing_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    call_ringing_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    user_picked_up: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    num_of_retries: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # AI output fields
    priority_tier: Mapped[str | None] = mapped_column(String(8), nullable=True)
    lead_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    intent_level: Mapped[str | None] = mapped_column(String(32), nullable=True)
    engagement_quality: Mapped[str | None] = mapped_column(String(32), nullable=True)
    drop_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    objection_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    objection_handleable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    recommended_action: Mapped[str | None] = mapped_column(String(64), nullable=True)
    callback_urgency_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config_interest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    budget_signal: Mapped[str | None] = mapped_column(String(32), nullable=True)
    language_preference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pitch_reached: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    closing_attempted: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    whatsapp_number_captured: Mapped[str | None] = mapped_column(String(32), nullable=True)
    site_visit_committed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    site_visit_timeframe: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_detected_by_user: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    audio_quality_issue: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    audio_loop_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    script_issue_detected: Mapped[str | None] = mapped_column(String(64), nullable=True)
    retry_time_recommendation: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enriched_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    sales_coach_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_depth: Mapped[str | None] = mapped_column(String(32), nullable=True)
    user_engagement_ratio: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_analyzed: Mapped[bool] = mapped_column(Boolean, default=False)

    # Human action fields
    assigned_agent: Mapped[str | None] = mapped_column(String(120), nullable=True)
    whatsapp_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    dnd_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    action_taken: Mapped[str | None] = mapped_column(String(64), nullable=True)
    callback_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    batch = relationship("CampaignBatch", back_populates="leads")
    flags = relationship("CampaignFlag", back_populates="lead", cascade="all, delete-orphan")


class CampaignFlag(Base):
    __tablename__ = "campaign_flags"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    batch_id: Mapped[str] = mapped_column(String, ForeignKey("campaign_batches.id"), index=True)
    lead_id: Mapped[str | None] = mapped_column(String, ForeignKey("campaign_leads.id"), nullable=True, index=True)

    flag_type: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    batch = relationship("CampaignBatch", back_populates="flags")
    lead = relationship("CampaignLead", back_populates="flags")
