"""add campaign ingestion schema

Revision ID: 20260413_campaign_ingestion
Revises: 
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260413_campaign_ingestion"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("developer", sa.String(length=200), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("bhk_options", sa.Text(), nullable=True),
        sa.Column("price_range_min", sa.Numeric(15, 2), nullable=True),
        sa.Column("price_range_max", sa.Numeric(15, 2), nullable=True),
        sa.Column("brochure_url", sa.Text(), nullable=True),
        sa.Column("status", sa.Enum("active", "completed", "upcoming", name="project_status"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "campaigns",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("agent_name", sa.String(length=100), nullable=True),
        sa.Column("total_calls", sa.Integer(), nullable=False),
        sa.Column("hot_count", sa.Integer(), nullable=False),
        sa.Column("warm_count", sa.Integer(), nullable=False),
        sa.Column("cold_count", sa.Integer(), nullable=False),
        sa.Column("new_leads_created", sa.Integer(), nullable=False),
        sa.Column("existing_leads_updated", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.String(), nullable=True),
        sa.Column("skipped_duplicates", sa.Integer(), nullable=False),
        sa.Column("failed_rows", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["agents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column("leads", sa.Column("campaign_id", sa.String(), nullable=True))
    op.add_column("leads", sa.Column("project_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_foreign_key("leads_campaign_id_fkey", "leads", "campaigns", ["campaign_id"], ["id"])

    op.add_column("activities", sa.Column("campaign_id", sa.String(), nullable=True))
    op.add_column("activities", sa.Column("recording_url", sa.Text(), nullable=True))
    op.add_column("activities", sa.Column("transcript", sa.Text(), nullable=True))
    op.add_column("activities", sa.Column("call_summary", sa.Text(), nullable=True))
    op.add_column("activities", sa.Column("call_eval_tag", sa.String(length=10), nullable=True))
    op.create_foreign_key("activities_campaign_id_fkey", "activities", "campaigns", ["campaign_id"], ["id"])

    op.execute("ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'campaign'")
    op.execute("ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'campaign_call'")


def downgrade() -> None:
    # Intentional: destructive rollback is omitted for production safety.
    pass
