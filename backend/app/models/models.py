import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Enum as SAEnum, Text, Numeric, Integer, ForeignKey, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(
        SAEnum("apartment", "villa", "plot", "commercial", "office", name="property_type"),
        default="apartment"
    )
    status: Mapped[str] = mapped_column(
        SAEnum("available", "sold", "rented", "under_negotiation", name="property_status"),
        default="available"
    )
    transaction_type: Mapped[str] = mapped_column(
        SAEnum("sale", "rent", "lease", name="transaction_type"),
        default="sale"
    )
    price: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    area_sqft: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    bedrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(100), nullable=True)
    amenities: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    media_urls: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    listed_by: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    site_visits = relationship("SiteVisit", back_populates="property")


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String, ForeignKey("leads.id"), index=True)
    contact_id: Mapped[str | None] = mapped_column(String, ForeignKey("contacts.id"), nullable=True)
    type: Mapped[str] = mapped_column(
        SAEnum("call", "whatsapp", "email", "site_visit", "note",
               "stage_change", "priya_call", "property_shown",
               "task_completed", "lead_created", "campaign_call", name="activity_type")
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(100), nullable=True)
    performed_by: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)
    campaign_id: Mapped[str | None] = mapped_column(String, ForeignKey("campaigns.id"), nullable=True, index=True)
    recording_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_eval_tag: Mapped[str | None] = mapped_column(String(10), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # flexible: duration, transcript, etc.

    lead = relationship("Lead", back_populates="activities")
    contact = relationship("Contact", back_populates="activities")
    performed_by_agent = relationship("Agent", back_populates="activities")
    campaign = relationship("Campaign", back_populates="activities")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String, ForeignKey("leads.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_type: Mapped[str] = mapped_column(
        SAEnum("call", "whatsapp", "email", "site_visit", "document", "other", name="task_type"),
        default="call"
    )
    assigned_to: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True, index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    priority: Mapped[str] = mapped_column(
        SAEnum("high", "normal", "low", name="task_priority"),
        default="normal"
    )
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "done", "overdue", "cancelled", name="task_status"),
        default="pending", index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lead = relationship("Lead", back_populates="tasks")
    assigned_agent = relationship("Agent", back_populates="tasks", foreign_keys=[assigned_to])


class SiteVisit(Base):
    __tablename__ = "site_visits"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String, ForeignKey("leads.id"), index=True)
    property_id: Mapped[str | None] = mapped_column(String, ForeignKey("properties.id"), nullable=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime)
    agent_id: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("scheduled", "done", "cancelled", "no_show", name="visit_status"),
        default="scheduled"
    )
    client_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lead = relationship("Lead", back_populates="site_visits")
    property = relationship("Property", back_populates="site_visits")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(
        SAEnum("task_due", "new_lead", "stage_change", "reminder",
               "stale_lead", "duplicate_detected", name="notification_type")
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agent = relationship("Agent", back_populates="notifications")
