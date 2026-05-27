"""Pydantic schemas for the WhatsApp Agent integration endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ─── Requests ────────────────────────────────────────────────────────────────

class WhatsAppTriggerRequest(BaseModel):
    """R1: Single trigger CRM → bot.

    Either `message` (for contacts with 24h window) or `template_name` (for new contacts).
    """
    phone: str = Field(..., min_length=4, description="Lead phone, any common format")
    call_id: str = Field(..., min_length=1, description="Idempotency key per trigger")
    message: Optional[str] = Field(default=None, min_length=1, max_length=4096, description="Free-form message (requires 24h window)")
    lead_id: Optional[str] = None
    template: Optional[str] = None
    template_name: Optional[str] = Field(default=None, description="WhatsApp template name (for new contacts)")
    template_params: Optional[list[str]] = Field(default=None, description="Template variable values in order")
    template_language: Optional[str] = Field(default="en", description="Template language code")
    meta: Optional[dict[str, Any]] = None


class WhatsAppBulkTriggerRequest(BaseModel):
    """R2: Bulk trigger CRM → bot.

    For new leads, use `template_name`. For existing contacts (24h+ window), use `message`.
    """
    call_id: str = Field(..., min_length=1)
    template: Optional[str] = None
    message: Optional[str] = Field(
        default=None,
        description="Free-form message (requires 24h window); phone-specific personalization handled by bot",
    )
    template_name: Optional[str] = Field(default=None, description="WhatsApp template name (for new contacts)")
    template_params: Optional[list[str]] = Field(default=None, description="Template variable values in order")
    template_language: Optional[str] = Field(default="en", description="Template language code")
    lead_ids: Optional[list[str]] = None
    phones: Optional[list[str]] = None
    meta: Optional[dict[str, Any]] = None


class WhatsAppTimelineEvent(BaseModel):
    """R4: A single inbound/outbound message synced from the bot."""
    phone: str = Field(..., min_length=4)
    call_id: Optional[str] = None
    direction: Literal["inbound", "outbound"]
    message: str = Field(..., min_length=1)
    occurred_at: Optional[datetime] = None
    ai_score: Optional[int] = Field(default=None, ge=0, le=100)
    intent: Optional[str] = None
    qualified: Optional[bool] = None
    summary: Optional[str] = None
    profile_patch: Optional[dict[str, Any]] = Field(
        default=None,
        description="Partial master_profile patch; only non-null keys are merged",
    )
    escalate: Optional[bool] = None


class WhatsAppEscalateRequest(BaseModel):
    """R5: Standalone escalation hook (also reachable inline via /timeline)."""
    phone: str = Field(..., min_length=4)
    reason: str = Field(..., min_length=1, max_length=500)
    ai_score: Optional[int] = Field(default=None, ge=0, le=100)
    intent: Optional[str] = None
    meta: Optional[dict[str, Any]] = None


# ─── Responses ───────────────────────────────────────────────────────────────

class IntegrationAck(BaseModel):
    """Generic always-200 response so the bot is never blocked by CRM errors."""
    status: Literal["ok", "skipped", "queued", "error"] = "ok"
    detail: Optional[str] = None
    lead_id: Optional[str] = None
    activity_id: Optional[str] = None
    task_id: Optional[str] = None


class BulkTriggerAck(IntegrationAck):
    accepted: int = 0
    skipped_duplicates: int = 0
    not_found: int = 0
    scheduled: int = 0


class WhatsAppContextResponse(BaseModel):
    found: bool
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    stage: Optional[str] = None
    lead_score: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    last_contacted_at: Optional[datetime] = None
    last_interaction_at: Optional[datetime] = None
    last_remark: Optional[str] = None
    master_profile: Optional[dict[str, Any]] = None
    recent_activities: list[dict[str, Any]] = Field(default_factory=list)
