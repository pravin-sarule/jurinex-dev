from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import text
from .config import settings

def _ensure_async_url(url: str) -> str:
    """Ensure URL uses asyncpg driver for create_async_engine."""
    if not url or not url.strip():
        return url
    u = url.strip()
    if u.startswith("postgresql://") and not u.startswith("postgresql+asyncpg://"):
        return u.replace("postgresql://", "postgresql+asyncpg://", 1)
    return u

_draft_url = _ensure_async_url(settings.DATABASE_URL)
engine = create_async_engine(_draft_url, echo=True)
AsyncSessionLocal = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()

# Auth_DB engine for role lookup (super_admins, admin_roles, users) - only if URL set
auth_engine = None
AuthSessionLocal = None
if getattr(settings, "AUTH_DATABASE_URL", None) and settings.AUTH_DATABASE_URL.strip():
    _auth_url = settings.AUTH_DATABASE_URL.strip()
    if _auth_url.startswith("postgresql://"):
        _auth_url = _auth_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif not _auth_url.startswith("postgresql+asyncpg://"):
        _auth_url = f"postgresql+asyncpg://{_auth_url}" if "://" not in _auth_url else _auth_url
    auth_engine = create_async_engine(_auth_url, echo=False)
    AuthSessionLocal = sessionmaker(auth_engine, expire_on_commit=False, class_=AsyncSession)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
