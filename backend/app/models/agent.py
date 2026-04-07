import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(SAEnum("admin", "manager", "agent", name="agent_role"), default="agent")
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    leads = relationship("Lead", back_populates="assigned_agent", foreign_keys="Lead.assigned_to")
    tasks = relationship("Task", back_populates="assigned_agent", foreign_keys="Task.assigned_to")
    activities = relationship("Activity", back_populates="performed_by_agent")
    notifications = relationship("Notification", back_populates="agent")
