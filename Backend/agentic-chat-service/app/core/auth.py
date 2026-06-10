from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Authentication token required")
    secret = get_settings().jwt_secret
    if not secret:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    try:
        decoded = jwt.decode(credentials.credentials, secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=403, detail="Invalid or expired token") from exc

    user_id = decoded.get("id") or decoded.get("userId") or decoded.get("user_id") or decoded.get("sub")
    if not user_id:
        raise HTTPException(status_code=400, detail="User ID missing from token")
    return {
        "id": str(user_id),
        "email": decoded.get("email"),
        "role": decoded.get("role") or "user",
    }
