-- 008_demo_booking.sql
-- Demo slots + bookings for JuriNex product demos

-- booking_status ENUM (safe create)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
        CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');
    END IF;
END
$$;

-- Available demo time slots
CREATE TABLE IF NOT EXISTS demo_slots (
    id         SERIAL    PRIMARY KEY,
    start_time TIMESTAMP NOT NULL,
    end_time   TIMESTAMP NOT NULL,
    is_booked  BOOLEAN   NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Confirmed demo bookings
CREATE TABLE IF NOT EXISTS demo_bookings (
    id           SERIAL         PRIMARY KEY,
    name         VARCHAR(100)   NOT NULL,
    email        VARCHAR(150)   NOT NULL,
    company      VARCHAR(150),
    slot_id      INT            REFERENCES demo_slots(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMP      NOT NULL,
    status       booking_status NOT NULL DEFAULT 'confirmed',
    notes        TEXT,
    created_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One booking per email per slot
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_email_slot'
    ) THEN
        ALTER TABLE demo_bookings
            ADD CONSTRAINT unique_email_slot UNIQUE (email, slot_id);
    END IF;
END
$$;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_demo_booking_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demo_booking_ts ON demo_bookings;
CREATE TRIGGER trg_demo_booking_ts
    BEFORE UPDATE ON demo_bookings
    FOR EACH ROW EXECUTE FUNCTION update_demo_booking_ts();

-- Seed initial slots (weekdays only, 10 AM and 2 PM) if table is empty
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM demo_slots LIMIT 1) THEN
        -- 10 AM – 11 AM slots
        INSERT INTO demo_slots (start_time, end_time)
        SELECT
            d + INTERVAL '10 hours',
            d + INTERVAL '11 hours'
        FROM generate_series(
            CURRENT_DATE + INTERVAL '1 day',
            CURRENT_DATE + INTERVAL '14 days',
            INTERVAL '1 day'
        ) AS d
        WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

        -- 2 PM – 3 PM slots
        INSERT INTO demo_slots (start_time, end_time)
        SELECT
            d + INTERVAL '14 hours',
            d + INTERVAL '15 hours'
        FROM generate_series(
            CURRENT_DATE + INTERVAL '1 day',
            CURRENT_DATE + INTERVAL '14 days',
            INTERVAL '1 day'
        ) AS d
        WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);
    END IF;
END
$$;
