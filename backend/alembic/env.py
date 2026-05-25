from logging.config import fileConfig

from sqlalchemy import create_engine
from sqlalchemy import pool

from alembic import context
#-------------------#
import os
from dotenv import load_dotenv
from app.db.base import Base
from app.models import *

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

#loading .env
load_dotenv()

# Use Supabase DB_CONNECTION; fall back to local DATABASE_URL
# NOTE: We intentionally do NOT call config.set_main_option() here because
# configparser treats '%' as an interpolation character, which breaks
# percent-encoded URLs (e.g., %40 for '@' in a password).
DB_URL = os.getenv("DB_CONNECTION") or os.getenv("DATABASE_URL")

# Decide connect_args based on whether we're using Supabase (needs SSL)
CONNECT_ARGS = {"sslmode": "require"} if os.getenv("DB_CONNECTION") else {}


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        connect_args=CONNECT_ARGS,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = create_engine(
        DB_URL,
        poolclass=pool.NullPool,
        connect_args=CONNECT_ARGS,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
