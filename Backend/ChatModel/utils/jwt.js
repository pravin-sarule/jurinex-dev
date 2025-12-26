const jwt = require('jsonwebtoken');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
  throw new Error('❌ JWT_SECRET environment variable is not defined. Please set it in your .env file.');
}

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

module.exports = { verifyToken };



