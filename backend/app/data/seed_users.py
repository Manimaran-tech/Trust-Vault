"""Seed the database with initial users using passwords from environment variables."""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User
from app.auth import hash_password
from app.config import get_settings

logger = logging.getLogger(__name__)


async def seed_demo_users(db: AsyncSession):
    """Create default users if they don't exist.
    Passwords are loaded from environment variables — no hardcoded credentials.
    """
    settings = get_settings()

    seed_users = [
        {
            "username": "admin",
            "email": "admin@trustvault.com",
            "full_name": "Admin User",
            "password": settings.SEED_ADMIN_PASSWORD,
            "role": "admin",
        },
        {
            "username": "csr_agent",
            "email": "csr@trustvault.com",
            "full_name": "Customer Service Rep",
            "password": settings.SEED_CSR_PASSWORD,
            "role": "csr",
        },
        {
            "username": "card_member",
            "email": "member@trustvault.com",
            "full_name": "Sarah Johnson",
            "password": settings.SEED_MEMBER_PASSWORD,
            "role": "card_member",
        },
    ]

    seeded_count = 0
    for user_data in seed_users:
        if not user_data["password"]:
            logger.warning(
                f"Skipping seed user '{user_data['username']}' — "
                f"no password set in environment. Set SEED_{user_data['role'].upper()}_PASSWORD."
            )
            continue

        result = await db.execute(
            select(User).where(User.username == user_data["username"])
        )
        existing = result.scalar_one_or_none()
        if not existing:
            user = User(
                username=user_data["username"],
                email=user_data["email"],
                full_name=user_data["full_name"],
                hashed_password=hash_password(user_data["password"]),
                role=user_data["role"],
            )
            db.add(user)
            seeded_count += 1
            logger.info(f"Seeded user: {user_data['username']} ({user_data['role']})")

    if seeded_count > 0:
        await db.commit()
