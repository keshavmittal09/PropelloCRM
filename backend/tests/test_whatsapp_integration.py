"""
Cross-verification tests for the WhatsApp ↔ CRM integration.

Covers pure logic (phone, profile merge, score conversion, SQL generation),
schema validation, and endpoint auth wiring with a mocked DB. A real Postgres
round-trip is left to the live smoke test (enums/JSONB can't be faked locally).

Run from backend/:  python -m pytest tests/test_whatsapp_integration.py -v
"""
import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@x/x")
os.environ.setdefault("SECRET_KEY", "test-key")
os.environ.setdefault("WHATSAPP_WEBHOOK_SECRET", "unit-test-secret")

import pytest
from sqlalchemy import and_, select
from sqlalchemy.dialects import postgresql


# ─── Phone utility ───────────────────────────────────────────────────────────

def test_to_e164_adds_country_code():
    from app.utils.phone import to_e164
    assert to_e164("9876543210") == "919876543210"

def test_to_e164_strips_symbols():
    from app.utils.phone import to_e164
    assert to_e164("+91 98765-43210") == "919876543210"
    assert to_e164("(91) 9876543210") == "919876543210"

def test_to_e164_idempotent_on_full_number():
    from app.utils.phone import to_e164
    assert to_e164("919876543210") == "919876543210"

def test_to_e164_empty():
    from app.utils.phone import to_e164
    assert to_e164("") == ""
    assert to_e164(None) == ""

def test_match_variants_covers_common_formats():
    from app.utils.phone import match_variants
    v = match_variants("9876543210")
    assert "919876543210" in v   # E.164
    assert "9876543210" in v     # bare 10-digit
    assert "+919876543210" in v  # plus-prefixed


# ─── master_profile merge ────────────────────────────────────────────────────

def test_merge_profile_preserves_existing():
    from app.services.whatsapp_integration import _merge_profile
    out = _merge_profile({"a": 1, "b": 2}, {"b": 3})
    assert out == {"a": 1, "b": 3}

def test_merge_profile_skips_nulls():
    from app.services.whatsapp_integration import _merge_profile
    out = _merge_profile({"a": 1}, {"a": None, "c": 5})
    assert out == {"a": 1, "c": 5}  # None must NOT overwrite

def test_merge_profile_handles_none_inputs():
    from app.services.whatsapp_integration import _merge_profile
    assert _merge_profile(None, None) == {}
    assert _merge_profile(None, {"x": 1}) == {"x": 1}
    assert _merge_profile({"x": 1}, None) == {"x": 1}


# ─── Score threshold ─────────────────────────────────────────────────────────

def test_hot_threshold_matches_bot_scale():
    from app.services.whatsapp_integration import HOT_SCORE_THRESHOLD
    # Bot score 7 → 70 escalates; 6 → 60 does not.
    assert 7 * 10 >= HOT_SCORE_THRESHOLD
    assert 6 * 10 < HOT_SCORE_THRESHOLD


# ─── Dedupe SQL generation (correct JSON accessor) ───────────────────────────

def test_dedupe_query_uses_json_text_extraction():
    from app.models.models import Activity
    q = select(Activity.id).where(
        and_(
            Activity.lead_id == "L1",
            Activity.type == "whatsapp_triggered",
            Activity.meta["call_id"].as_string() == "C1",
        )
    ).limit(1)
    sql = str(q.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "->>" in sql            # Postgres JSON text operator present
    assert "'call_id'" in sql
    assert "'C1'" in sql


# ─── Schema validation ───────────────────────────────────────────────────────

def test_trigger_request_requires_core_fields():
    from app.schemas.whatsapp import WhatsAppTriggerRequest
    from pydantic import ValidationError
    WhatsAppTriggerRequest(phone="919876543210", call_id="c1", message="hi")
    with pytest.raises(ValidationError):
        WhatsAppTriggerRequest(phone="919876543210", call_id="c1")  # no message

def test_timeline_event_direction_literal():
    from app.schemas.whatsapp import WhatsAppTimelineEvent
    from pydantic import ValidationError
    WhatsAppTimelineEvent(phone="919876543210", direction="inbound", message="hi")
    WhatsAppTimelineEvent(phone="919876543210", direction="outbound", message="hi")
    with pytest.raises(ValidationError):
        WhatsAppTimelineEvent(phone="919876543210", direction="sideways", message="hi")

def test_timeline_event_score_range():
    from app.schemas.whatsapp import WhatsAppTimelineEvent
    from pydantic import ValidationError
    p = "919876543210"
    WhatsAppTimelineEvent(phone=p, direction="inbound", message="m", ai_score=0)
    WhatsAppTimelineEvent(phone=p, direction="inbound", message="m", ai_score=100)
    with pytest.raises(ValidationError):
        WhatsAppTimelineEvent(phone=p, direction="inbound", message="m", ai_score=101)
    with pytest.raises(ValidationError):
        WhatsAppTimelineEvent(phone=p, direction="inbound", message="m", ai_score=-1)


# ─── Endpoint auth wiring (mocked DB) ────────────────────────────────────────

@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.dependencies import get_db

    class _FakeResult:
        def scalar_one_or_none(self): return None
        def scalars(self):
            class _S:
                def all(self_inner): return []
            return _S()

    class _FakeSession:
        async def execute(self, *a, **k): return _FakeResult()
        async def get(self, *a, **k): return None
        async def commit(self): pass
        async def rollback(self): pass
        async def flush(self): pass
        def add(self, *a, **k): pass

    async def _override_db():
        yield _FakeSession()

    app.dependency_overrides[get_db] = _override_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_trigger_403_without_secret(client):
    r = client.post("/api/whatsapp/trigger",
                    json={"phone": "919876543210", "call_id": "c1", "message": "hi"})
    assert r.status_code == 403
    assert "X-Webhook-Secret" in r.json()["detail"]

def test_trigger_403_with_wrong_secret(client):
    r = client.post("/api/whatsapp/trigger",
                    headers={"X-Webhook-Secret": "wrong"},
                    json={"phone": "919876543210", "call_id": "c1", "message": "hi"})
    assert r.status_code == 403

def test_context_403_without_secret(client):
    r = client.get("/api/whatsapp/context", params={"phone": "919876543210"})
    assert r.status_code == 403

def test_context_200_with_secret_returns_not_found(client):
    r = client.get("/api/whatsapp/context",
                   headers={"X-Webhook-Secret": "unit-test-secret"},
                   params={"phone": "919876543210"})
    assert r.status_code == 200
    assert r.json()["found"] is False

def test_timeline_403_without_secret(client):
    r = client.post("/api/whatsapp/timeline",
                    json={"phone": "919876543210", "direction": "inbound", "message": "hi"})
    assert r.status_code == 403

def test_bulk_trigger_200_with_no_targets(client):
    r = client.post("/api/whatsapp/bulk-trigger",
                    headers={"X-Webhook-Secret": "unit-test-secret"},
                    json={"call_id": "b1"})
    assert r.status_code == 200
    assert r.json()["status"] == "skipped"

def test_escalate_403_without_secret(client):
    r = client.post("/api/whatsapp/escalate",
                    json={"phone": "919876543210", "reason": "test"})
    assert r.status_code == 403
