import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Enum as SAEnum, Numeric, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(SAEnum("admin", "manager", "agent", "call_agent", name="agent_role"), default="agent")
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Performance scoring fields (Feature 5 & 6)
    star_rating: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    performance_score: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    completion_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    conversion_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    avg_remark_quality: Mapped[float] = mapped_column(Numeric(4, 2), default=0)
    rating_set_by: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)
    rating_set_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_score_computed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    leads = relationship("Lead", back_populates="assigned_agent", foreign_keys="Lead.assigned_to")
    tasks = relationship("Task", back_populates="assigned_agent", foreign_keys="Task.assigned_to")
    activities = relationship("Activity", back_populates="performed_by_agent")
    notifications = relationship("Notification", back_populates="agent")
    rated_by_agent = relationship("Agent", foreign_keys=[rating_set_by], remote_side=[id])
    performance_snapshots = relationship("PerformanceSnapshot", back_populates="agent", order_by="PerformanceSnapshot.snapshot_date.desc()")
