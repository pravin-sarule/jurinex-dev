const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  Buffer.from(process.env.GCS_KEY_BASE64, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
