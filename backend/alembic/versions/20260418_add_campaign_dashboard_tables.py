"""add campaign dashboard tables

Revision ID: 20260418_campaign_dashboard
Revises: 20260413_campaign_ingestion
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260418_campaign_dashboard"
down_revision = "20260413_campaign_ingestion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaign_batches",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("upload_date", sa.DateTime(), nullable=False),
        sa.Column("total_leads", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("p1_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("p2_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("p3_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("p4_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("p5_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_quality_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("conversion_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("campaign_health_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("campaign_health_label", sa.String(length=32), nullable=True),
        sa.Column("ai_insights", sa.JSON(), nullable=True),
        sa.Column("analysis_status", sa.String(length=32), nullable=False, server_default="processing"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_campaign_batches_name", "campaign_batches", ["name"], unique=False)

    op.create_table(
        "campaign_leads",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("phone_number", sa.BigInteger(), nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=True),
        sa.Column("call_id", sa.String(length=200), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("recording_url", sa.Text(), nullable=True),
        sa.Column("extracted_entities", sa.JSON(), nullable=True),
        sa.Column("call_eval_tag", sa.String(length=32), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("call_conversation_quality", sa.JSON(), nullable=True),
        sa.Column("call_dialing_at", sa.DateTime(), nullable=True),
        sa.Column("call_ringing_at", sa.DateTime(), nullable=True),
        sa.Column("user_picked_up", sa.DateTime(), nullable=True),
        sa.Column("num_of_retries", sa.Integer(), nullable=True),
        sa.Column("priority_tier", sa.String(length=8), nullable=True),
        sa.Column("lead_score", sa.Integer(), nullable=True),
        sa.Column("intent_level", sa.String(length=32), nullable=True),
        sa.Column("engagement_quality", sa.String(length=32), nullable=True),
        sa.Column("drop_reason", sa.String(length=64), nullable=True),
        sa.Column("objection_type", sa.String(length=64), nullable=True),
        sa.Column("objection_handleable", sa.Boolean(), nullable=True),
        sa.Column("recommended_action", sa.String(length=64), nullable=True),
        sa.Column("callback_urgency_hours", sa.Integer(), nullable=True),
        sa.Column("config_interest", sa.String(length=64), nullable=True),
        sa.Column("budget_signal", sa.String(length=32), nullable=True),
        sa.Column("language_preference", sa.String(length=32), nullable=True),
        sa.Column("pitch_reached", sa.Boolean(), nullable=True),
        sa.Column("closing_attempted", sa.Boolean(), nullable=True),
        sa.Column("whatsapp_number_captured", sa.String(length=32), nullable=True),
        sa.Column("site_visit_committed", sa.Boolean(), nullable=True),
        sa.Column("site_visit_timeframe", sa.String(length=32), nullable=True),
        sa.Column("ai_detected_by_user", sa.Boolean(), nullable=True),
        sa.Column("audio_quality_issue", sa.Boolean(), nullable=True),
        sa.Column("audio_loop_detected", sa.Boolean(), nullable=True),
        sa.Column("script_issue_detected", sa.String(length=64), nullable=True),
        sa.Column("retry_time_recommendation", sa.String(length=32), nullable=True),
        sa.Column("enriched_summary", sa.Text(), nullable=True),
        sa.Column("key_quote", sa.Text(), nullable=True),
        sa.Column("sales_coach_note", sa.Text(), nullable=True),
        sa.Column("transcript_depth", sa.String(length=32), nullable=True),
        sa.Column("user_engagement_ratio", sa.String(length=32), nullable=True),
        sa.Column("ai_analyzed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("assigned_agent", sa.String(length=120), nullable=True),
        sa.Column("whatsapp_sent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("dnd_flag", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("action_taken", sa.String(length=64), nullable=True),
        sa.Column("callback_script", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["campaign_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_campaign_leads_batch_id", "campaign_leads", ["batch_id"], unique=False)
    op.create_index("ix_campaign_leads_call_id", "campaign_leads", ["call_id"], unique=False)

    op.create_table(
        "campaign_flags",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("lead_id", sa.String(), nullable=True),
        sa.Column("flag_type", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["campaign_batches.id"]),
        sa.ForeignKeyConstraint(["lead_id"], ["campaign_leads.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_campaign_flags_batch_id", "campaign_flags", ["batch_id"], unique=False)
    op.create_index("ix_campaign_flags_lead_id", "campaign_flags", ["lead_id"], unique=False)
    op.create_index("ix_campaign_flags_flag_type", "campaign_flags", ["flag_type"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_campaign_flags_flag_type", table_name="campaign_flags")
    op.drop_index("ix_campaign_flags_lead_id", table_name="campaign_flags")
    op.drop_index("ix_campaign_flags_batch_id", table_name="campaign_flags")
    op.drop_table("campaign_flags")

    op.drop_index("ix_campaign_leads_call_id", table_name="campaign_leads")
    op.drop_index("ix_campaign_leads_batch_id", table_name="campaign_leads")
    op.drop_table("campaign_leads")

    op.drop_index("ix_campaign_batches_name", table_name="campaign_batches")
    op.drop_table("campaign_batches")
