from app.schemas.schemas import InboundLead
from app.services.lead_service import extract_appointment_context


def _lead(**overrides):
    payload = {
        "source": "priya_ai",
        "name": "Riya",
        "phone": "9999999999",
    }
    payload.update(overrides)
    return InboundLead(**payload)


def test_extract_appointment_context_from_personal_notes():
    lead = _lead(personal_notes="Appointment/Timeline preference: Sunday 5 PM")
    context = extract_appointment_context(lead)
    assert context is not None
    assert "appointment" in context.lower() or "sunday" in context.lower()


def test_extract_appointment_context_from_summary():
    lead = _lead(transcript_summary="Client wants a site visit next week with family")
    context = extract_appointment_context(lead)
    assert context is not None
    assert "visit" in context.lower() or "next week" in context.lower()


def test_extract_appointment_context_returns_none_without_signal():
    lead = _lead(transcript_summary="Client asked about brochure only", personal_notes="No schedule yet")
    assert extract_appointment_context(lead) is None
