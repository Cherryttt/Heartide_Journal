"""Create the baseline schema, including account cloud state.

Revision ID: 20260615_0001
Revises:
Create Date: 2026-06-15
"""

from alembic import op

from database import Base


revision = "20260615_0001"
down_revision = None
branch_labels = None
depends_on = None

TABLE_ORDER = [
    "users",
    "records",
    "quotes",
    "books",
    "poems",
    "words",
    "reading_feedback",
    "user_states",
]


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in TABLE_ORDER:
        Base.metadata.tables[table_name].create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in reversed(TABLE_ORDER):
        Base.metadata.tables[table_name].drop(bind=bind, checkfirst=True)
