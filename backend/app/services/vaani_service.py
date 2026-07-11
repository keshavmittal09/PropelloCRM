"""Vaani Voice — trigger outbound AI voice calls from the backend.

Mirrors the frontend /api/trigger-call route so the scheduler can auto-call a
lead when their follow-up falls due.
"""
import logging
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def to_e164(raw: Optional[str]) -> Optional[str]:
    """Normalise an Indian phone number to E.164 (+91XXXXXXXXXX)."""
    if not raw:
        return None
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"+91{digits[1:]}"
    if raw.strip().startswith("+") and len(digits) >= 11:
        return f"+{digits}"
    return None


async def trigger_ai_call(phone: str, name: Optional[str] = None) -> bool:
    """Place an outbound AI voice call. Returns True if Vaani accepted it."""
    if not settings.VAANI_API_KEY or not settings.VAANI_AGENT_ID:
        logger.warning("Vaani not configured (VAANI_API_KEY / VAANI_AGENT_ID) — skipping AI call")
        return False

    contact_number = to_e164(phone)
    if not contact_number:
        logger.warning("Vaani: invalid phone %r — skipping AI call", phone)
        return False

    call_name = (name or "").strip() or "Customer"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                settings.VAANI_API_URL,
                headers={"X-API-Key": settings.VAANI_API_KEY, "Content-Type": "application/json"},
                json={
                    "agent_id": settings.VAANI_AGENT_ID,
                    "contact_number": contact_number,
                    # Vaani ignores unknown keys; send the name under common ones.
                    "contact_name": call_name,
                    "name": call_name,
                    "customer_name": call_name,
                },
            )
        if res.status_code in (200, 201, 202):
            logger.info("Vaani AI call placed to %s", contact_number)
            return True
        logger.error("Vaani rejected call to %s: %s %s", contact_number, res.status_code, res.text[:200])
        return False
    except Exception as e:
        logger.error("Vaani call failed for %s: %s", contact_number, e)
        return False
