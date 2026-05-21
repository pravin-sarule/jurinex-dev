-- Add phone number field to demo_bookings
ALTER TABLE demo_bookings ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
