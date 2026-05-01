"""Add demographic fields to leads for call_agent profiling.

Revision ID: 20260430_demographic_fields
Revises: 20260426_add_performance_rating_assignment_schema
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '20260430_demographic_fields'
down_revision = '20260426_add_performance_rating_assignment_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('leads', sa.Column('age_range', sa.String(20), nullable=True))
    op.add_column('leads', sa.Column('occupation', sa.String(50), nullable=True))
    op.add_column('leads', sa.Column('occupation_other', sa.String(100), nullable=True))
    op.add_column('leads', sa.Column('family_size', sa.String(10), nullable=True))
    op.add_column('leads', sa.Column('income_range', sa.String(30), nullable=True))
    op.add_column('leads', sa.Column('property_budget', sa.String(30), nullable=True))
    op.add_column('leads', sa.Column('preferred_location', sa.String(200), nullable=True))
    op.add_column('leads', sa.Column('purchase_timeline', sa.String(20), nullable=True))
    op.add_column('leads', sa.Column('last_call_status', sa.String(20), nullable=True))
    op.add_column('leads', sa.Column('last_call_topics', postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default='[]'))
    op.add_column('leads', sa.Column('last_call_interest', sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column('leads', 'last_call_interest')
    op.drop_column('leads', 'last_call_topics')
    op.drop_column('leads', 'last_call_status')
    op.drop_column('leads', 'purchase_timeline')
    op.drop_column('leads', 'preferred_location')
    op.drop_column('leads', 'property_budget')
    op.drop_column('leads', 'income_range')
    op.drop_column('leads', 'family_size')
    op.drop_column('leads', 'occupation_other')
    op.drop_column('leads', 'occupation')
    op.drop_column('leads', 'age_range')
