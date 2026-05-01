"""Enable cascade delete for campaign-owned data.

Revision ID: 20260501_enable_campaign_delete_cascade
Revises: 20260426_add_performance_rating_assignment_schema
Create Date: 2026-05-01
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260501_enable_campaign_delete_cascade"
down_revision = "20260426_add_performance_rating_assignment_schema"
branch_labels = None
depends_on = None


def _recreate_fk_with_cascade(table: str, constraint: str, local_col: str, remote_table: str, remote_col: str) -> None:
    op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
    op.execute(
        f"ALTER TABLE {table} "
        f"ADD CONSTRAINT {constraint} FOREIGN KEY ({local_col}) "
        f"REFERENCES {remote_table}({remote_col}) ON DELETE CASCADE"
    )


def _recreate_fk_without_cascade(table: str, constraint: str, local_col: str, remote_table: str, remote_col: str) -> None:
    op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
    op.execute(
        f"ALTER TABLE {table} "
        f"ADD CONSTRAINT {constraint} FOREIGN KEY ({local_col}) "
        f"REFERENCES {remote_table}({remote_col})"
    )


def upgrade() -> None:
    # Campaign deletion should remove campaign-linked leads and activities.
    _recreate_fk_with_cascade("leads", "leads_campaign_id_fkey", "campaign_id", "campaigns", "id")
    _recreate_fk_with_cascade("activities", "activities_campaign_id_fkey", "campaign_id", "campaigns", "id")

    # Lead deletion should remove dependent records.
    _recreate_fk_with_cascade("activities", "activities_lead_id_fkey", "lead_id", "leads", "id")
    _recreate_fk_with_cascade("tasks", "tasks_lead_id_fkey", "lead_id", "leads", "id")
    _recreate_fk_with_cascade("site_visits", "site_visits_lead_id_fkey", "lead_id", "leads", "id")
    _recreate_fk_with_cascade("followups", "followups_lead_id_fkey", "lead_id", "leads", "id")


def downgrade() -> None:
    _recreate_fk_without_cascade("followups", "followups_lead_id_fkey", "lead_id", "leads", "id")
    _recreate_fk_without_cascade("site_visits", "site_visits_lead_id_fkey", "lead_id", "leads", "id")
    _recreate_fk_without_cascade("tasks", "tasks_lead_id_fkey", "lead_id", "leads", "id")
    _recreate_fk_without_cascade("activities", "activities_lead_id_fkey", "lead_id", "leads", "id")

    _recreate_fk_without_cascade("activities", "activities_campaign_id_fkey", "campaign_id", "campaigns", "id")
    _recreate_fk_without_cascade("leads", "leads_campaign_id_fkey", "campaign_id", "campaigns", "id")
