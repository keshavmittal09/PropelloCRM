"""
FollowUp Model
--------------
Tracks scheduled and executed follow-up actions (WhatsApp, email, call).
The follow-up engine creates these records; the scheduler executes them.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Enum as SAEnum, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class FollowUp(Base):
    __tablename__ = "followups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id: Mapped[str] = mapped_column(String, ForeignKey("leads.id"), index=True)
    contact_id: Mapped[str | None] = mapped_column(String, ForeignKey("contacts.id"), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)

    channel: Mapped[str] = mapped_column(
        SAEnum("whatsapp", "email", "call", "in_app", name="followup_channel"),
        default="whatsapp"
    )
    template: Mapped[str | None] = mapped_column(String(100), nullable=True)
    message_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str | None] = mapped_column(String(200), nullable=True)

    scheduled_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    status: Mapped[str] = mapped_column(
        SAEnum("pending", "sent", "failed", "cancelled", name="followup_status"),
        default="pending", index=True
    )
    triggered_by: Mapped[str] = mapped_column(
        SAEnum("new_lead", "stage_change", "no_response", "visit_reminder",
               "post_visit", "reengagement", "manual", "ai_recommendation",
               name="followup_trigger"),
        default="manual"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lead = relationship("Lead")
    contact = relationship("Contact")
