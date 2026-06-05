import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Text, ForeignKey, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    phone: Mapped[str] = mapped_column(String, index=True)
    contact_id: Mapped[str | None] = mapped_column(String, ForeignKey("contacts.id"), nullable=True, index=True)
    lead_id: Mapped[str | None] = mapped_column(String, ForeignKey("leads.id"), nullable=True, index=True)
    direction: Mapped[str] = mapped_column(String(10), default="inbound")  # inbound | outbound
    message: Mapped[str] = mapped_column(Text)
    wa_message_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    sender_name: Mapped[str | None] = mapped_column(String, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
