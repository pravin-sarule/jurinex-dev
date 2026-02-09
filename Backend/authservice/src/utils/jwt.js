// const jwt = require('jsonwebtoken');
// require('dotenv').config();

// const generateToken = (user) => {
//   return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
// };

// const verifyToken = (token) => {
//   try {
//     return jwt.verify(token, process.env.JWT_SECRET);
//   } catch (error) {
//     return null;
//   }
// };

// module.exports = { generateToken, verifyToken };


const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

/**
 * DUAL-ID STRATEGY: Generate deterministic UUID from numeric user ID
 * 
 * Uses UUIDv5 approach: namespace + numeric ID → deterministic UUID
 * This ensures the same numeric ID always generates the same UUID.
 * 
 * Namespace: JURINEX-USER-ID-NAMESPACE (static, never changes)
 */
const USER_UUID_NAMESPACE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'; // Fixed namespace

const generateUserUUID = (numericId) => {
  // Create deterministic UUID from numeric ID using sha256
  const hash = crypto.createHash('sha256')
    .update(USER_UUID_NAMESPACE + ':' + numericId.toString())
    .digest('hex');

  // Format as UUID v4 style (8-4-4-4-12)
  const uuid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),  // Version 4 indicator
    ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20), // Variant
    hash.substring(20, 32)
  ].join('-');

  return uuid;
};

/**
 * Generate JWT token with DUAL-ID support
 * 
 * ADDITIVE CHANGE - Backward compatible:
 * - Existing 'id' field: numeric (UNCHANGED)
 * - New 'user_uuid' field: UUID string (ADDED)
 * - Existing 'email' field: string (UNCHANGED)
 */
const generateToken = (user) => {
  const numericId = user.id;
  const userUuid = generateUserUUID(numericId);

  console.log(`[JWT] Generating token for user: id=${numericId}, user_uuid=${userUuid}`);

  return jwt.sign(
    {
      id: numericId,           // KEEP: numeric ID for existing services
      user_uuid: userUuid,     // ADD: UUID for new services (drafting-template-service)
      email: user.email        // KEEP: email unchanged
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = { generateToken, verifyToken, generateUserUUID };