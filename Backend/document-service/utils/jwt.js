// const jwt = require('jsonwebtoken');
// require('dotenv').config();

// if (!process.env.JWT_SECRET) {
//   throw new Error('JWT_SECRET environment variable is not defined. Please set it in your .env file.');
// }

// const generateToken = (user) => {
//   return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
// };

// const verifyToken = (token) => {
//   try {
//     return jwt.verify(token, process.env.JWT_SECRET);
//   } catch (error) {
//     console.error("❌ JWT verification failed:", error.message);
//     return null;
//   }
// };

// module.exports = { generateToken, verifyToken };

// utils/jwt.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Ensure JWT_SECRET is defined
if (!process.env.JWT_SECRET) {
  throw new Error('❌ JWT_SECRET environment variable is not defined. Please set it in your .env file.');
}

/**
 * Generate JWT token
 * @param {Object} user - User object containing at least { id, email }
 * @returns {string} JWT token
 */
const generateToken = (user) => {
  if (!user || !user.id || !user.email) {
    throw new Error('User object must contain id and email to generate a token.');
  }

  return jwt.sign(
    { id: user.id, email: user.email }, // payload
    process.env.JWT_SECRET,             // secret
    { expiresIn: '24h' }                // options
  );
};

/**
 * Verify JWT token
 * @param {string} token - JWT token string
 * @returns {Object|null} Decoded payload or null if invalid
 */
const verifyToken = (token) => {
  try {
    if (!token) {
      throw new Error("Token is missing");
    }
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.error("❌ JWT verification failed:", error.message);
    return null;
  }
};

module.exports = { generateToken, verifyToken };
