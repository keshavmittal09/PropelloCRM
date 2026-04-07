"""
Multi-Source Webhook Adapters
-----------------------------
Each lead source (Priya AI, Facebook Ads, 99acres, MagicBricks,
Google Ads, website forms) gets a dedicated endpoint that normalizes
the incoming payload into an InboundLead and feeds it through the
unified process_inbound_lead() pipeline.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.dependencies import get_db
from app.core.config import settings
from app.schemas.schemas import InboundLead, InboundLeadResponse
from app.services.lead_service import process_inbound_lead
import logging
import re

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── PRIYA AI CHATBOT WEBHOOK ────────────────────────────────────────────────

@router.post("/priya", response_model=InboundLeadResponse)
async def priya_webhook(
    data: InboundLead,
    db: AsyncSession = Depends(get_db),
    x_priya_secret: Optional[str] = Header(None),
):
    """
    Receives leads captured by the Priya AI chatbot.
    The chatbot POSTs here after every conversation where lead data is extracted.
    """
    if x_priya_secret and x_priya_secret != settings.PRIYA_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid Priya webhook secret")

    data.source = "priya_ai"
    logger.info(f"[Priya] Inbound lead: {data.name} | {data.phone}")
    result = await process_inbound_lead(db, data)
    return InboundLeadResponse(**result)


# ─── WEBSITE CONTACT FORM WEBHOOK ────────────────────────────────────────────

@router.post("/website", response_model=InboundLeadResponse)
async def website_form_webhook(
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Simple JSON webhook for website contact/enquiry forms.
    Accepts: {name, phone, email, message, property_type, budget, location}
    """
    phone = data.get("phone", "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    lead_data = InboundLead(
        source="website",
        name=data.get("name", "Website Visitor"),
        phone=phone,
        email=data.get("email"),
        budget_min=_parse_budget(data.get("budget_min")),
        budget_max=_parse_budget(data.get("budget_max") or data.get("budget")),
        property_type=data.get("property_type"),
        location_preference=data.get("location") or data.get("location_preference"),
        timeline=data.get("timeline"),
        personal_notes=data.get("message") or data.get("notes"),
    )

    logger.info(f"[Website] Inbound lead: {lead_data.name} | {phone}")
    result = await process_inbound_lead(db, lead_data)
    return InboundLeadResponse(**result)


# ─── FACEBOOK LEAD ADS WEBHOOK ───────────────────────────────────────────────

@router.get("/facebook/verify")
async def facebook_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    """Facebook webhook verification endpoint (required by Meta Graph API)."""
    if hub_mode == "subscribe" and hub_verify_token == settings.PRIYA_WEBHOOK_SECRET:
        return int(hub_challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/facebook", response_model=InboundLeadResponse)
async def facebook_lead_ads_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Receives leads from Facebook Lead Ads via the Meta Graph API webhook.
    Facebook sends: {entry: [{changes: [{value: {field_data: [...]}}]}]}
    In production, you'd fetch the full lead data via the Graph API.
    For now, this handles the common forwarded/n8n format.
    """
    try:
        # Try to parse Facebook's native format
        entry = payload.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        field_data = value.get("field_data", [])

        # Build a dict from field_data [{name, values}] format
        fields = {}
        for field in field_data:
            fname = field.get("name", "").lower()
            fvalues = field.get("values", [""])
            fields[fname] = fvalues[0] if fvalues else ""

        name = fields.get("full_name") or fields.get("name") or "Facebook Lead"
        phone = fields.get("phone_number") or fields.get("phone") or ""
        email = fields.get("email") or ""

        if not phone:
            # Fallback: try flat payload (n8n/Zapier forwarded format)
            name = payload.get("name") or payload.get("full_name") or "Facebook Lead"
            phone = payload.get("phone") or payload.get("phone_number") or ""
            email = payload.get("email") or ""

        if not phone:
            raise HTTPException(status_code=400, detail="No phone number in Facebook payload")

        lead_data = InboundLead(
            source="facebook_ads",
            name=name,
            phone=phone,
            email=email or None,
            location_preference=fields.get("city") or payload.get("city"),
            budget_max=_parse_budget(fields.get("budget") or payload.get("budget")),
            property_type=fields.get("property_type") or payload.get("property_type"),
            personal_notes=f"Facebook Lead Ad campaign",
        )

        logger.info(f"[Facebook] Inbound lead: {name} | {phone}")
        result = await process_inbound_lead(db, lead_data)
        return InboundLeadResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Facebook] Failed to parse payload: {e}")
        raise HTTPException(status_code=400, detail=f"Could not parse Facebook payload: {str(e)}")


# ─── 99ACRES WEBHOOK ─────────────────────────────────────────────────────────

@router.post("/99acres", response_model=InboundLeadResponse)
async def portal_99acres_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Receives leads from 99acres.
    Typically the email notification is forwarded via Zapier/n8n
    which parses it into JSON: {name, phone, email, property_interested, message}
    """
    phone = payload.get("phone", "").strip()
    if not phone:
        # Try to extract phone from message body (email parser fallback)
        body = payload.get("body") or payload.get("message") or ""
        phone_match = re.search(r'(\+91[\s-]?\d{10}|\d{10})', body)
        phone = phone_match.group(1) if phone_match else ""

    if not phone:
        raise HTTPException(status_code=400, detail="No phone number found")

    name = payload.get("name") or _extract_name_from_body(payload.get("body", "")) or "99acres Lead"

    lead_data = InboundLead(
        source="99acres",
        name=name,
        phone=phone,
        email=payload.get("email"),
        property_type=payload.get("property_type") or payload.get("property_interested"),
        location_preference=payload.get("location") or payload.get("locality"),
        budget_max=_parse_budget(payload.get("budget")),
        personal_notes=payload.get("message") or payload.get("body"),
    )

    logger.info(f"[99acres] Inbound lead: {name} | {phone}")
    result = await process_inbound_lead(db, lead_data)
    return InboundLeadResponse(**result)


# ─── MAGICBRICKS WEBHOOK ─────────────────────────────────────────────────────

@router.post("/magicbricks", response_model=InboundLeadResponse)
async def portal_magicbricks_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Receives leads from MagicBricks.
    Same pattern as 99acres — email forwarded via Zapier/n8n.
    """
    phone = payload.get("phone", "").strip()
    if not phone:
        body = payload.get("body") or payload.get("message") or ""
        phone_match = re.search(r'(\+91[\s-]?\d{10}|\d{10})', body)
        phone = phone_match.group(1) if phone_match else ""

    if not phone:
        raise HTTPException(status_code=400, detail="No phone number found")

    name = payload.get("name") or "MagicBricks Lead"

    lead_data = InboundLead(
        source="magicbricks",
        name=name,
        phone=phone,
        email=payload.get("email"),
        property_type=payload.get("property_type"),
        location_preference=payload.get("location") or payload.get("locality"),
        budget_max=_parse_budget(payload.get("budget")),
        personal_notes=payload.get("message") or payload.get("body"),
    )

    logger.info(f"[MagicBricks] Inbound lead: {name} | {phone}")
    result = await process_inbound_lead(db, lead_data)
    return InboundLeadResponse(**result)


# ─── GOOGLE ADS WEBHOOK ──────────────────────────────────────────────────────

@router.post("/google-ads", response_model=InboundLeadResponse)
async def google_ads_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Receives leads from Google Ads lead form extensions.
    Payload typically forwarded via n8n/Zapier from Google Ads API.
    """
    phone = payload.get("phone") or payload.get("phone_number") or ""
    if not phone:
        raise HTTPException(status_code=400, detail="No phone number in Google Ads payload")

    lead_data = InboundLead(
        source="google_ads",
        name=payload.get("name") or payload.get("full_name") or "Google Ads Lead",
        phone=phone,
        email=payload.get("email"),
        property_type=payload.get("property_type"),
        location_preference=payload.get("location") or payload.get("city"),
        budget_max=_parse_budget(payload.get("budget")),
        personal_notes=f"Google Ads campaign: {payload.get('campaign_name', 'N/A')}",
    )

    logger.info(f"[GoogleAds] Inbound lead: {lead_data.name} | {phone}")
    result = await process_inbound_lead(db, lead_data)
    return InboundLeadResponse(**result)


# ─── GENERIC / N8N / ZAPIER WEBHOOK ──────────────────────────────────────────

@router.post("/generic", response_model=InboundLeadResponse)
async def generic_webhook(
    data: InboundLead,
    db: AsyncSession = Depends(get_db),
):
    """
    Universal catch-all webhook for n8n, Zapier, Make.com, or any
    custom integration. Accepts the standard InboundLead schema directly.
    """
    logger.info(f"[Generic] Inbound lead: {data.name} | {data.phone} | source={data.source}")
    result = await process_inbound_lead(db, data)
    return InboundLeadResponse(**result)


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def _parse_budget(value) -> Optional[float]:
    """Try to parse a budget string like '50L', '1.2Cr', '8000000' into a float."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().lower().replace(",", "").replace("₹", "").replace("rs", "").strip()
    try:
        if "cr" in s:
            return float(re.sub(r'[^\d.]', '', s)) * 10_000_000
        elif "l" in s or "lac" in s or "lakh" in s:
            return float(re.sub(r'[^\d.]', '', s)) * 100_000
        else:
            return float(re.sub(r'[^\d.]', '', s))
    except (ValueError, TypeError):
        return None


def _extract_name_from_body(body: str) -> Optional[str]:
    """Try to extract a name from an email notification body."""
    patterns = [
        r'(?:Name|Buyer|Contact)[\s:]+([A-Za-z\s]{2,30})',
        r'Dear\s+([A-Za-z\s]{2,30})',
    ]
    for pat in patterns:
        match = re.search(pat, body, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None
