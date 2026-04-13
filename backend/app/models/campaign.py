import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Numeric, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), index=True)
    developer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bhk_options: Mapped[list | None] = mapped_column(Text, nullable=True)  # JSON string array
    price_range_min: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    price_range_max: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    brochure_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("active", "completed", "upcoming", name="project_status"),
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    campaigns = relationship("Campaign", back_populates="project")


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), index=True)
    project_id: Mapped[str | None] = mapped_column(String, ForeignKey("projects.id"), nullable=True, index=True)
    agent_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_calls: Mapped[int] = mapped_column(Integer, default=0)
    hot_count: Mapped[int] = mapped_column(Integer, default=0)
    warm_count: Mapped[int] = mapped_column(Integer, default=0)
    cold_count: Mapped[int] = mapped_column(Integer, default=0)
    new_leads_created: Mapped[int] = mapped_column(Integer, default=0)
    existing_leads_updated: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[str | None] = mapped_column(String, ForeignKey("agents.id"), nullable=True)
    skipped_duplicates: Mapped[int] = mapped_column(Integer, default=0)
    failed_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="campaigns")
    leads = relationship("Lead", back_populates="campaign")
    activities = relationship("Activity", back_populates="campaign")
