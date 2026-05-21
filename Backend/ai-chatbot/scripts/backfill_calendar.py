"""One-off: create Google Calendar events for bookings missing them."""
from __future__ import annotations

from app.services.calendar_service import create_calendar_event
from app.services.db import close_pool, get_db_connection, init_pool


def main() -> None:
    init_pool()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT b.id, b.name, b.email, b.phone, b.company,
                           s.start_time, s.end_time
                    FROM   demo_bookings b
                    JOIN   demo_slots s ON s.id = b.slot_id
                    WHERE  b.status IN ('pending', 'confirmed')
                    ORDER  BY b.id DESC
                    LIMIT  20
                    """
                )
                rows = cur.fetchall()

        for row in rows:
            result = create_calendar_event(
                name=row["name"],
                email=row["email"],
                start_time=row["start_time"],
                end_time=row["end_time"],
                company=row.get("company") or "",
                phone=row.get("phone") or "",
            )
            print(f"booking_id={row['id']} -> {result}")
            if result.get("success"):
                with get_db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE demo_bookings SET status = 'confirmed' WHERE id = %s",
                            (row["id"],),
                        )
                    conn.commit()
    finally:
        close_pool()


if __name__ == "__main__":
    main()
