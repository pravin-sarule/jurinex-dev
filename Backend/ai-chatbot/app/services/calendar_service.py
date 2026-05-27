"""Google Calendar integration — creates demo events on the booking calendar."""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger("ai_chatbot.calendar")


def _calendar_libs_available() -> bool:
    try:
        import google.oauth2.service_account  # noqa: F401
        import googleapiclient.discovery  # noqa: F401
        return True
    except ImportError:
        return False


def _to_calendar_local(dt: datetime, tz_name: str) -> datetime:
    """demo_slots times are stored as naive wall-clock in GOOGLE_CALENDAR_TZ."""
    tz = ZoneInfo(tz_name)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _format_event_datetime(dt: datetime, tz_name: str) -> str:
    """RFC3339 local time string for Google Calendar dateTime + timeZone."""
    return _to_calendar_local(dt, tz_name).strftime("%Y-%m-%dT%H:%M:%S")


def _parse_service_account_json(raw: str) -> dict:
    """Decode GOOGLE_SERVICE_ACCOUNT_JSON (base64 or raw JSON)."""
    value = (raw or "").strip().strip('"').strip("'")
    if not value:
        raise ValueError("empty service account payload")

    try:
        return json.loads(base64.b64decode(value).decode("utf-8"))
    except Exception:
        pass

    return json.loads(value)


def create_calendar_event(
    *,
    name: str,
    email: str,
    start_time: datetime,
    end_time: datetime,
    company: str = "",
    phone: str = "",
) -> dict:
    """
    Create a Google Calendar event for a confirmed demo booking.

    Writes to the shared group calendar (GOOGLE_CALENDAR_ID).
    No DWD required — the service account is an editor on that calendar.

    Returns:
        {"success": True, "event_id": ..., "html_link": ...}
        {"success": False, "error": ...}
    """
    if not _calendar_libs_available():
        logger.warning(
            "google-api-python-client / google-auth not installed in this Python — "
            "run: venv\\Scripts\\python.exe -m pip install -r requirements.txt"
        )
        return {"success": False, "error": "Calendar library not installed"}

    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError

    from app.core.config import get_settings

    settings = get_settings()

    sa_json = (settings.google_service_account_json or "").strip()
    calendar_id = settings.google_calendar_id or "primary"
    calendar_tz = settings.google_calendar_tz or "UTC"
    subject = (settings.google_calendar_subject or "").strip()
    # DWD "sub" must be a Workspace user email — not a label or status string.
    if subject and "@" not in subject:
        logger.warning(
            "GOOGLE_CALENDAR_SUBJECT=%r is not a valid email — skipping impersonation. "
            "Leave blank for group calendars, or set to the Workspace user to impersonate.",
            subject,
        )
        subject = ""

    if not sa_json:
        logger.warning("GOOGLE_SERVICE_ACCOUNT_JSON not configured — skipping calendar event")
        return {"success": False, "error": "Calendar credentials not configured"}

    try:
        sa_info = _parse_service_account_json(sa_json)
        credentials = service_account.Credentials.from_service_account_info(
            sa_info,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        if subject:
            credentials = credentials.with_subject(subject)
            logger.debug("Using DWD — impersonating %s", subject)
    except Exception as exc:
        logger.error("Failed to decode/parse service account credentials: %s", exc)
        return {"success": False, "error": f"Invalid credentials: {exc}"}

    try:
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)

        start_local = _to_calendar_local(start_time, calendar_tz)
        end_local = _to_calendar_local(end_time, calendar_tz)

        date_str = start_local.strftime("%A, %b %d %Y")
        time_str = (
            f"{start_local.strftime('%I:%M %p').lstrip('0')} – "
            f"{end_local.strftime('%I:%M %p').lstrip('0')} ({calendar_tz})"
        )

        description_lines = [
            "📅 JuriNex Product Demo",
            "",
            f"👤 Name    : {name}",
            f"📧 Email   : {email}",
        ]
        if phone:
            description_lines.append(f"📞 Phone   : {phone}")
        if company:
            description_lines.append(f"🏢 Company : {company}")
        description_lines += [
            "",
            f"🗓  Date    : {date_str}",
            f"🕐 Time    : {time_str}",
            "",
            "This event was auto-created by JuriNex demo booking system.",
        ]

        event_body: dict = {
            "summary": f"JuriNex Demo - {name}" if name else "JuriNex Demo",
            "description": "\n".join(description_lines),
            "start": {
                "dateTime": _format_event_datetime(start_time, calendar_tz),
                "timeZone": calendar_tz,
            },
            "end": {
                "dateTime": _format_event_datetime(end_time, calendar_tz),
                "timeZone": calendar_tz,
            },
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "email", "minutes": 24 * 60},
                    {"method": "popup", "minutes": 30},
                ],
            },
        }
        created = (
            service.events()
            .insert(calendarId=calendar_id, body=event_body)
            .execute()
        )

        logger.info(
            "Calendar event created event_id=%s name=%r email=%s",
            created.get("id"),
            name,
            email,
        )
        return {
            "success": True,
            "event_id": created.get("id"),
            "meeting_link": "",
            "html_link": created.get("htmlLink", ""),
        }

    except HttpError as exc:
        status = getattr(getattr(exc, "resp", None), "status", "") or ""
        reason = getattr(exc, "reason", None) or str(exc)
        logger.error(
            "Failed to create calendar event for %s — HTTP %s: %s",
            email,
            status,
            reason,
        )
        return {"success": False, "error": f"Calendar API error: {reason}"}
    except Exception as exc:
        logger.exception("Failed to create calendar event for %s", email)
        return {"success": False, "error": str(exc)}
