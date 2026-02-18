"""
Resolve user role from Auth_DB (super_admins + admin_roles, users) for template routing.
Admin/Super-admin → use templates table. User → use user_templates table.
"""
from typing import Optional, Literal
from sqlalchemy import text
from ..database import AuthSessionLocal

RoleType = Literal["admin", "user"]


async def get_role_by_user_id(user_id: int) -> Optional[RoleType]:
    """
    Check Auth_DB: if user_id is in super_admins with role admin/super-admin → 'admin'.
    Else if user_id is in users → 'user'. Otherwise None.
    """
    if not AuthSessionLocal:
        return None
    try:
        async with AuthSessionLocal() as session:
            # Check super_admins + admin_roles first
            r = await session.execute(
                text("""
                    SELECT r.name
                    FROM super_admins a
                    JOIN admin_roles r ON a.role_id = r.id
                    WHERE a.id = :uid
                """),
                {"uid": user_id}
            )
            row = r.fetchone()
            if row:
                role_name = (row[0] or "").lower().strip()
                if role_name in (
                    "super-admin", "super_admin", "superadmin",
                    "user-admin", "user_admin", "useradmin",
                    "admin", "administrator"
                ):
                    return "admin"
            # Check users table
            r2 = await session.execute(
                text("SELECT 1 FROM users WHERE id = :uid"),
                {"uid": user_id}
            )
            if r2.fetchone():
                return "user"
            return None
    except Exception as e:
        print(f"DEBUG: Auth DB role check failed for user_id={user_id}: {e}")
        return None
