import uuid
from datetime import datetime

from sqlalchemy import DateTime, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationDispatchLog(Base):
    __tablename__ = "notification_dispatch_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    event_key: Mapped[str] = mapped_column(String(255), index=True)
    channel: Mapped[str] = mapped_column(String(40), index=True)
    recipient_type: Mapped[str] = mapped_column(String(40), index=True)
    recipient_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    recipient_address: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class NotificationLog(Base):
    """Spec-aligned notification delivery log for assignment notifications."""

    __tablename__ = "notification_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    lead_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    campaign_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
