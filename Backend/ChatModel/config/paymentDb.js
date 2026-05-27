const { Pool } = require('pg');
require('dotenv').config();

const paymentPool = new Pool({
  connectionString: process.env.PAYMENT_DB_URL,
});

paymentPool.connect()
  .then(() => console.log('✅ ChatModel: Payment DB connected.'))
  .catch(err => console.error('❌ ChatModel: Payment DB connection failed:', err));

module.exports = paymentPool;
