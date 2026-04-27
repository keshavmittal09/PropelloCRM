from app.services.campaign_service import classify_lead


def test_classify_mixed_signals_defaults_to_warm_without_concrete_hot():
    summary = "Customer is interested but also said not interested now and asked to call later"
    transcript = "He said budget concern and not interested currently."

    result = classify_lead(
        summary=summary,
        transcript=transcript,
        call_eval_tag="",
        extracted_entities="{}",
    )

    assert result["score"] == "warm"
    assert result["stage"] == "contacted"


def test_classify_concrete_hot_overrides_cold_to_hot_site_visit():
    summary = "Site visit scheduled for tomorrow at 5 PM, but lead had earlier budget concerns"
    transcript = "Not interested previously, now confirmed visit tomorrow with family"

    result = classify_lead(
        summary=summary,
        transcript=transcript,
        call_eval_tag="yes",
        extracted_entities='{"site_visit":"confirmed"}',
    )

    assert result["score"] == "hot"
    assert result["stage"] == "site_visit_scheduled"


def test_classify_eval_yes_without_hot_signal_becomes_warm_followup():
    summary = "Customer asked to think and call back later"
    transcript = "Could visit maybe next week if price matches"

    result = classify_lead(
        summary=summary,
        transcript=transcript,
        call_eval_tag="yes",
        extracted_entities="{}",
    )

    assert result["score"] in {"warm", "hot"}
    # For this scenario we expect non-cold outcome and follow-up intent.
    assert result["stage"] in {"contacted", "negotiation", "site_visit_scheduled"}
