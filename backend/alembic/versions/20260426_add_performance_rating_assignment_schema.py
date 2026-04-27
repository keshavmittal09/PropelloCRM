"""Add performance rating assignment schema

Revision ID: 20260426_add_performance_rating_assignment_schema
Revises: 20260418_add_campaign_dashboard_tables
Create Date: 2026-04-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260426_add_performance_rating_assignment_schema'
down_revision = '20260418_add_campaign_dashboard_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add new priority values P1-P5 to lead_priority enum
    # PostgreSQL doesn't support removing enum values, so we need to recreate
    op.execute("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P1'")
    op.execute("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P2'")
    op.execute("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P3'")
    op.execute("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P4'")
    op.execute("ALTER TYPE lead_priority ADD VALUE IF NOT EXISTS 'P5'")

    # 2. Add performance fields to agents table
    op.add_column('agents', sa.Column('star_rating', sa.Integer(), nullable=True))
    op.add_column('agents', sa.Column('performance_score', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'))
    op.add_column('agents', sa.Column('completion_rate', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'))
    op.add_column('agents', sa.Column('conversion_rate', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'))
    op.add_column('agents', sa.Column('avg_remark_quality', sa.Numeric(precision=4, scale=2), nullable=False, server_default='0'))
    op.add_column('agents', sa.Column('rating_set_by', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('rating_set_at', sa.DateTime(), nullable=True))
    op.add_column('agents', sa.Column('last_score_computed_at', sa.DateTime(), nullable=True))

    # Add foreign key for rating_set_by
    op.create_foreign_key(
        'fk_agents_rating_set_by',
        'agents', 'agents',
        ['rating_set_by'], ['id']
    )

    # 3. Add remark quality fields to tasks table
    op.add_column('tasks', sa.Column('remark_quality_score', sa.Numeric(precision=4, scale=2), nullable=True))
    op.add_column('tasks', sa.Column('remark_quality_feedback', sa.Text(), nullable=True))

    # 4. Create performance_snapshots table
    op.create_table(
        'performance_snapshots',
        sa.Column('id', sa.String(), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('agent_id', sa.String(), nullable=False),
        sa.Column('snapshot_date', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('performance_score', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'),
        sa.Column('completion_rate', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'),
        sa.Column('conversion_rate', sa.Numeric(precision=5, scale=2), nullable=False, server_default='0'),
        sa.Column('avg_remark_quality', sa.Numeric(precision=4, scale=2), nullable=False, server_default='0'),
        sa.Column('tasks_completed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('leads_converted', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE')
    )

    # Create index on performance_snapshots
    op.create_index('ix_performance_snapshots_agent_id', 'performance_snapshots', ['agent_id'])
    op.create_index('ix_performance_snapshots_snapshot_date', 'performance_snapshots', ['snapshot_date'])


def downgrade() -> None:
    # Drop performance_snapshots table
    op.drop_index('ix_performance_snapshots_snapshot_date')
    op.drop_index('ix_performance_snapshots_agent_id')
    op.drop_table('performance_snapshots')

    # Remove remark quality fields from tasks
    op.drop_column('tasks', 'remark_quality_feedback')
    op.drop_column('tasks', 'remark_quality_score')

    # Remove foreign key and performance fields from agents
    op.drop_constraint('fk_agents_rating_set_by', 'agents', type_='foreignkey')
    op.drop_column('agents', 'last_score_computed_at')
    op.drop_column('agents', 'rating_set_at')
    op.drop_column('agents', 'rating_set_by')
    op.drop_column('agents', 'avg_remark_quality')
    op.drop_column('agents', 'conversion_rate')
    op.drop_column('agents', 'completion_rate')
    op.drop_column('agents', 'performance_score')
    op.drop_column('agents', 'star_rating')

    # Note: Cannot remove enum values in PostgreSQL, leaving P1-P5 in place
