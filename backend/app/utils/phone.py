"""
Phone-number normalization for WhatsApp integration lead matching.

CRM contacts were created by different flows (manual, bulk ingest, campaign)
and may store numbers as "9876543210", "+919876543210", "91 9876543210", etc.
The WhatsApp bot delivers numbers in Meta's E.164 form ("919876543210").
"""
from __future__ import annotations

import re

from app.core.config import settings


_DIGITS_ONLY = re.compile(r"\D+")


def to_e164(phone: str, default_country_code: str | None = None) -> str:
    """Strip everything non-digit and ensure the country-code prefix.

    Returns digits only (no '+'), matching how Meta and WATI deliver numbers.
    Empty/None input returns "".
    """
    if not phone:
        return ""
    digits = _DIGITS_ONLY.sub("", str(phone))
    if not digits:
        return ""
    cc = (default_country_code or settings.WHATSAPP_DEFAULT_COUNTRY_CODE or "").strip()
    if cc and not digits.startswith(cc) and len(digits) == 10:
        digits = cc + digits
    return digits


def match_variants(phone: str) -> list[str]:
    """Generate the variant strings we should try when looking up an existing contact.

    Order matters — exact E.164 first, then bare 10-digit, then '+'-prefixed.
    Caller can `WHERE phone IN (...)` to match any historical format.
    """
    if not phone:
        return []
    e164 = to_e164(phone)
    if not e164:
        return []
    cc = (settings.WHATSAPP_DEFAULT_COUNTRY_CODE or "").strip()

    variants = {e164, f"+{e164}"}
    if cc and e164.startswith(cc):
        bare = e164[len(cc):]
        if bare:
            variants.add(bare)
            variants.add(f"+{cc} {bare}")
            variants.add(f"{cc} {bare}")
    return list(variants)
