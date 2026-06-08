"""Add AI workflow fields to leads: call_score, sentiment, intent_level, interest_level,
ai_recommended_action, whatsapp_status, retry tracking fields, and new activity types.

Revision ID: 20260608_ai_workflow_fields
Revises: 20260430_demographic_fields
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260608_ai_workflow_fields'
down_revision = '20260430_demographic_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── New lead columns ────────────────────────────────────────────────────────
    op.add_column('leads', sa.Column('call_score', sa.Integer(), nullable=True))
    op.add_column('leads', sa.Column('call_sentiment', sa.String(20), nullable=True))
    op.add_column('leads', sa.Column('intent_level', sa.String(20), nullable=True))
    op.add_column('leads', sa.Column('interest_level', sa.String(20), nullable=True))
    op.add_column('leads', sa.Column('ai_recommended_action', sa.Text(), nullable=True))
    op.add_column('leads', sa.Column('last_call_transcript', sa.Text(), nullable=True))
    op.add_column('leads', sa.Column('last_call_summary', sa.Text(), nullable=True))
    op.add_column('leads', sa.Column('whatsapp_status', sa.String(20), nullable=False, server_default='not_sent'))
    op.add_column('leads', sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('leads', sa.Column('last_ai_call_date', sa.DateTime(), nullable=True))
    op.add_column('leads', sa.Column('next_call_date', sa.DateTime(), nullable=True))
    op.add_column('leads', sa.Column('max_retries_reached', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('leads', sa.Column('next_followup_date', sa.DateTime(), nullable=True))

    op.create_index('ix_leads_next_call_date', 'leads', ['next_call_date'])

    # ── Extend activity_type enum with new values ───────────────────────────────
    # PostgreSQL requires ALTER TYPE for existing enums
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'ai_call_completed'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'ai_analysis_generated'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'classified'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'retry_scheduled'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'whatsapp_auto_sent'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'assignment_update'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'priority_change'")


def downgrade() -> None:
    op.drop_index('ix_leads_next_call_date', table_name='leads')
    op.drop_column('leads', 'next_followup_date')
    op.drop_column('leads', 'max_retries_reached')
    op.drop_column('leads', 'next_call_date')
    op.drop_column('leads', 'last_ai_call_date')
    op.drop_column('leads', 'retry_count')
    op.drop_column('leads', 'whatsapp_status')
    op.drop_column('leads', 'last_call_summary')
    op.drop_column('leads', 'last_call_transcript')
    op.drop_column('leads', 'ai_recommended_action')
    op.drop_column('leads', 'interest_level')
    op.drop_column('leads', 'intent_level')
    op.drop_column('leads', 'call_sentiment')
    op.drop_column('leads', 'call_score')
    # Note: PostgreSQL does not support removing enum values in downgrade
