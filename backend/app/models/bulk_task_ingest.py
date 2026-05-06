"""
Bulk Task Ingest models — stores CSV upload batches and individual call records.

These are NEW tables (additive only) — no existing tables are modified.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer,
    String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base


class BulkTaskIngest(Base):
    """Represents a single CSV upload batch for bulk task ingestion."""
    __tablename__ = "bulk_task_ingests"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    batch_name: Mapped[str] = mapped_column(String(200), index=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(
        String, ForeignKey("agents.id"), nullable=True
    )

    total_records: Mapped[int] = mapped_column(Integer, default=0)
    hot_count: Mapped[int] = mapped_column(Integer, default=0)
    warm_count: Mapped[int] = mapped_column(Integer, default=0)
    cold_count: Mapped[int] = mapped_column(Integer, default=0)
    created_leads: Mapped[int] = mapped_column(Integer, default=0)
    created_tasks: Mapped[int] = mapped_column(Integer, default=0)
    skipped_records: Mapped[int] = mapped_column(Integer, default=0)
    failed_records: Mapped[int] = mapped_column(Integer, default=0)

    # Caller names extracted from CSV tabs/sheets
    caller_names: Mapped[list | None] = mapped_column(JSON, nullable=True)

    status: Mapped[str] = mapped_column(
        String(32), default="processing"
    )  # processing | completed | failed

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    records = relationship(
        "BulkTaskRecord",
        back_populates="ingest",
        cascade="all, delete-orphan",
    )


class BulkTaskRecord(Base):
    """
    Individual row from the uploaded CSV.
    Maps 1:1 to a call record, and links to Contact/Lead/Task once ingested.
    """
    __tablename__ = "bulk_task_records"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    ingest_id: Mapped[str] = mapped_column(
        String, ForeignKey("bulk_task_ingests.id", ondelete="CASCADE"), index=True
    )

    # ── Raw CSV fields ──────────────────────────────────────────────────
    caller_name: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )  # The tab/sheet name this record belongs to (agent name)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    call_id: Mapped[str | None] = mapped_column(
        String(200), nullable=True, index=True
    )
    phone_number: Mapped[str | None] = mapped_column(
        String(30), nullable=True, index=True
    )
    transcript_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    recording_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_entities: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_eval_tags: Mapped[str | None] = mapped_column(String(200), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_conversation_quality: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    call_dialing_at: Mapped[str | None] = mapped_column(String(100), nullable=True)
    call_ringing_at: Mapped[str | None] = mapped_column(String(100), nullable=True)
    user_picked_up: Mapped[str | None] = mapped_column(String(100), nullable=True)
    call_status: Mapped[str | None] = mapped_column(String(100), nullable=True)
    duration: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lead_heat_bucket: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True
    )  # Hot / Warm / Cold
    lead_heat_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Linked CRM records (set during ingestion) ───────────────────────
    contact_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("contacts.id"), nullable=True
    )
    lead_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True
    )
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )

    # ── Assignment / status ─────────────────────────────────────────────
    assigned_to: Mapped[str | None] = mapped_column(
        String, ForeignKey("agents.id"), nullable=True
    )
    ingestion_status: Mapped[str] = mapped_column(
        String(32), default="pending"
    )  # pending | ingested | skipped | failed

    # ── Extra metadata from CSV (catch-all for unexpected columns) ──────
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    ingest = relationship("BulkTaskIngest", back_populates="records")
