const pool = require('./src/config/db');

async function fixSchema() {
  try {
    console.log('Altering table firms...');
    await pool.query('ALTER TABLE firms ALTER COLUMN establishment_date DROP NOT NULL');
    console.log('Dropped NOT NULL on establishment_date');
    await pool.query('ALTER TABLE firms ALTER COLUMN bar_enrollment_number DROP NOT NULL');
    console.log('Dropped NOT NULL on bar_enrollment_number');
    await pool.query('ALTER TABLE firms ALTER COLUMN enrollment_date DROP NOT NULL');
    console.log('Dropped NOT NULL on enrollment_date');
    await pool.query('ALTER TABLE firms ALTER COLUMN state_bar_council DROP NOT NULL');
    console.log('Dropped NOT NULL on state_bar_council');
    
    // Check if there are other columns that shouldn't be NOT NULL in firm registration
    await pool.query('ALTER TABLE firms ALTER COLUMN gst_number DROP NOT NULL');
    await pool.query('ALTER TABLE firms ALTER COLUMN landline DROP NOT NULL');
    await pool.query('ALTER TABLE firms ALTER COLUMN district DROP NOT NULL');

    // Simplified firm registration form does not collect address/PAN yet
    await pool.query('ALTER TABLE firms ALTER COLUMN office_address DROP NOT NULL');
    console.log('Dropped NOT NULL on office_address');
    await pool.query('ALTER TABLE firms ALTER COLUMN city DROP NOT NULL');
    console.log('Dropped NOT NULL on city');
    await pool.query('ALTER TABLE firms ALTER COLUMN state DROP NOT NULL');
    console.log('Dropped NOT NULL on state');
    await pool.query('ALTER TABLE firms ALTER COLUMN pin_code DROP NOT NULL');
    console.log('Dropped NOT NULL on pin_code');
    await pool.query('ALTER TABLE firms ALTER COLUMN pan_number DROP NOT NULL');
    console.log('Dropped NOT NULL on pan_number');

    console.log('Schema fixed successfully');
  } catch (error) {
    console.error('Error fixing schema:', error);
  } finally {
    process.exit();
  }
}

fixSchema();
