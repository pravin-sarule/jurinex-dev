"""Demo booking service — DB operations for demo slots and bookings."""
from __future__ import annotations

import logging
from datetime import datetime

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("ai_chatbot.demo")


def _fmt_label(start: datetime, end: datetime) -> str:
    day = start.strftime("%a, %b %d").replace(" 0", " ")
    t_s = start.strftime("%I:%M %p").lstrip("0") or "12:00 AM"
    t_e = end.strftime("%I:%M %p").lstrip("0") or "12:00 AM"
    return f"{day}  {t_s} - {t_e}"


def _seed_slots(conn) -> None:
    """Insert the next 14 days of 10 AM and 2 PM weekday slots (skip weekends)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO demo_slots (start_time, end_time)
            SELECT d + INTERVAL '10 hours', d + INTERVAL '11 hours'
            FROM generate_series(
                CURRENT_DATE + INTERVAL '1 day',
                CURRENT_DATE + INTERVAL '14 days',
                INTERVAL '1 day'
            ) AS d
            WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
            ON CONFLICT DO NOTHING;

            INSERT INTO demo_slots (start_time, end_time)
            SELECT d + INTERVAL '14 hours', d + INTERVAL '15 hours'
            FROM generate_series(
                CURRENT_DATE + INTERVAL '1 day',
                CURRENT_DATE + INTERVAL '14 days',
                INTERVAL '1 day'
            ) AS d
            WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
            ON CONFLICT DO NOTHING;
            """
        )
    conn.commit()
    logger.info("Seeded demo slots for the next 14 days")


def get_available_slots() -> list[dict]:
    """Return up to 10 upcoming unbooked demo slots, auto-seeding if none exist."""
    if not is_db_available():
        logger.warning("DB unavailable — returning empty slots")
        return []
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, start_time, end_time
                    FROM   demo_slots
                    WHERE  is_booked = FALSE AND start_time > NOW()
                    ORDER  BY start_time
                    LIMIT  10
                    """
                )
                rows = cur.fetchall()

            if not rows:
                logger.info("No future slots found — seeding new ones")
                _seed_slots(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id, start_time, end_time
                        FROM   demo_slots
                        WHERE  is_booked = FALSE AND start_time > NOW()
                        ORDER  BY start_time
                        LIMIT  10
                        """
                    )
                    rows = cur.fetchall()

        return [
            {
                "id": r["id"],
                "start_time": r["start_time"].isoformat(),
                "end_time": r["end_time"].isoformat(),
                "label": _fmt_label(r["start_time"], r["end_time"]),
            }
            for r in rows
        ]
    except Exception:
        logger.exception("get_available_slots error")
        return []


def book_demo(name: str, email: str, slot_id: int, company: str = "") -> dict:
    """
    Book a demo slot atomically.
    Returns {success, booking_id, scheduled_at, message} or {success, error}.
    """
    if not name or not email or not slot_id:
        return {"success": False, "error": "name, email, and slot_id are required"}

    if not is_db_available():
        return {"success": False, "error": "Database unavailable"}

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # Lock the slot to prevent double booking
                cur.execute(
                    """
                    SELECT id, start_time, end_time
                    FROM   demo_slots
                    WHERE  id = %s AND is_booked = FALSE
                    FOR UPDATE
                    """,
                    (slot_id,),
                )
                slot = cur.fetchone()
                if not slot:
                    return {
                        "success": False,
                        "error": "Slot is no longer available. Please select another.",
                    }

                # Mark slot as booked
                cur.execute(
                    "UPDATE demo_slots SET is_booked = TRUE WHERE id = %s",
                    (slot_id,),
                )

                # Insert booking record
                cur.execute(
                    """
                    INSERT INTO demo_bookings (name, email, company, slot_id, scheduled_at, status)
                    VALUES (%s, %s, %s, %s, %s, 'confirmed')
                    ON CONFLICT (email, slot_id) DO NOTHING
                    RETURNING id
                    """,
                    (name, email, company or None, slot_id, slot["start_time"]),
                )
                booking = cur.fetchone()

                if not booking:
                    # Conflict — don't commit the slot update
                    conn.rollback()
                    return {
                        "success": False,
                        "error": "A demo is already booked for this email and slot.",
                    }

                conn.commit()
                label = _fmt_label(slot["start_time"], slot["end_time"])
                return {
                    "success": True,
                    "booking_id": booking["id"],
                    "scheduled_at": slot["start_time"].isoformat(),
                    "label": label,
                    "message": (
                        f"Your demo is confirmed for {label}. "
                        f"We'll send details to {email} shortly!"
                    ),
                }
    except Exception as exc:
        logger.exception("book_demo error slot_id=%s", slot_id)
        return {"success": False, "error": f"Booking failed: {exc}"}
