"""Add whatsapp_messages table for chat history.

Revision ID: 20260605_whatsapp_messages
Revises: 20260430_demographic_fields
"""
from alembic import op
import sqlalchemy as sa

revision = '20260605_whatsapp_messages'
down_revision = '20260430_demographic_fields'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'whatsapp_messages',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('phone', sa.String(), nullable=False, index=True),
        sa.Column('contact_id', sa.String(), sa.ForeignKey('contacts.id'), nullable=True),
        sa.Column('lead_id', sa.String(), sa.ForeignKey('leads.id'), nullable=True),
        sa.Column('direction', sa.String(10), nullable=False, server_default='inbound'),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('wa_message_id', sa.String(), nullable=True, unique=True),
        sa.Column('sender_name', sa.String(), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()')),
    )
    op.create_index('ix_whatsapp_messages_phone', 'whatsapp_messages', ['phone'])
    op.create_index('ix_whatsapp_messages_lead_id', 'whatsapp_messages', ['lead_id'])
    op.create_index('ix_whatsapp_messages_timestamp', 'whatsapp_messages', ['timestamp'])


def downgrade():
    op.drop_table('whatsapp_messages')
