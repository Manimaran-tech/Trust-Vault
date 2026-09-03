from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings

settings = get_settings()

_IS_SQLITE = settings.DATABASE_URL.startswith("sqlite")

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    # SQLite permits exactly one writer. The decision loop holds a session open
    # across LLM calls that can run for minutes on a local runtime, and with
    # the default zero busy timeout any concurrent write — a card transaction
    # arriving, an audit row being appended — fails instantly with "database is
    # locked" and surfaces to the browser as a 500 with no CORS headers, which
    # then reads as a CORS bug rather than the lock contention it is.
    connect_args={"timeout": 30.0} if _IS_SQLITE else {},
)


if _IS_SQLITE:

    @event.listens_for(engine.sync_engine, "connect")
    def _configure_sqlite(dbapi_connection, _record):
        """
        Put every connection into WAL with a generous busy timeout.

        WAL lets readers proceed while a writer holds the file, so the console
        keeps rendering during a long decision. The busy timeout makes a
        competing writer wait its turn instead of failing on contact. Both are
        per-connection settings and have to be applied on connect, not once at
        startup.
        """
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    """Create all tables in the database."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_tables():
    """Drop all tables (use with caution)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
