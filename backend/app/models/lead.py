import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Enum as SAEnum, Text, Numeric, Integer, ForeignKey, Date, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_id: Mapped[str] = mapped_column(String, ForeignKey("contacts.id"), index=True)
    source: Mapped[str] = mapped_column(
        SAEnum("priya_ai", "website", "facebook_ads", "google_ads",
               "99acres", "magicbricks", "walk_in", "referral",
               "email_campaign", "manual", name="lead_source"),
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
    interested_properties: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of property IDs
    lost_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    days_in_stage: Mapped[int] = mapped_column(Integer, default=0)
    priority: Mapped[str] = mapped_column(
        SAEnum("high", "normal", "low", name="lead_priority"),
        default="normal"
    )
    expected_close_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    priya_memory_brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_count: Mapped[int] = mapped_column(Integer, default=0)
    ai_analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    stage_changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    contact = relationship("Contact", back_populates="leads")
    assigned_agent = relationship("Agent", back_populates="leads", foreign_keys=[assigned_to])
    activities = relationship("Activity", back_populates="lead", order_by="Activity.performed_at.desc()")
    tasks = relationship("Task", back_populates="lead")
    site_visits = relationship("SiteVisit", back_populates="lead")
