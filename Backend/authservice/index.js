
// const express = require("express");
// const bodyParser = require("body-parser");
// const cors = require("cors");
// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcrypt");
// const dotenv = require("dotenv");

// dotenv.config();
// const authRoutes = require("./src/routes/authRoutes"); // your auth routes
// const pool = require("./src/config/db.js"); // your Postgres pool

// const app = express();
// const PORT = process.env.PORT || 5001;

// // --------- CORS Setup ---------
// // Allow your frontend origin
// app.use(cors({
//   origin: 'http://localhost:5173', // or '*' for all origins
//   methods: ['GET','POST','PUT','DELETE','OPTIONS'],
//   credentials: true // if you need cookies or auth headers
// }));

// // For preflight OPTIONS requests
// app.options('*', cors());
// // --------- Middleware ---------
// app.use(bodyParser.json({ limit: "10mb" }));
// app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// // --------- Health Check ---------
// app.get("/health", (req, res) => {
//   res.json({ status: "Auth Service is running" });
// });

// // --------- Auth Routes ---------
// app.use("/api/auth", authRoutes);

// // --------- Error Handler ---------
// app.use((err, req, res, next) => {
//   if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
//     console.error("Bad JSON:", err.message);
//     return res.status(400).send({ message: "Invalid JSON payload" });
//   }
//   console.error(err.stack);
//   res.status(500).send("Something broke!");
// });

// // --------- Start Server ---------
// app.listen(PORT, () => {
//   console.log(`Auth Service running on port ${PORT}`);
// });



// const express = require("express");
// const bodyParser = require("body-parser");
// const cors = require("cors");
// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcrypt");
// const dotenv = require("dotenv");

// dotenv.config();
// const authRoutes = require("./src/routes/authRoutes"); // your auth routes
// const pool = require("./src/config/db.js"); // your Postgres pool

// const app = express();
// const PORT = process.env.PORT || 5001;

// // --------- CORS Setup ---------
// // Allow your frontend origin
// // ✅ Allowed origins
// const allowedOrigins = ['http://localhost:5173', 'https://jurinex.netlify.app/']; // Add your frontend URLs

// // ✅ CORS setup
// app.use(cors({
//   origin: function(origin, callback) {
//     if (!origin) return callback(null, true); // Allow non-browser tools like Postman
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
//     return callback(new Error("Not allowed by CORS"));
//   },
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
// }));

// // For preflight OPTIONS requests
// app.options('*', cors());
// // --------- Middleware ---------
// app.use(bodyParser.json({ limit: "10mb" }));
// app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// // --------- Health Check ---------
// app.get("/health", (req, res) => {
//   res.json({ status: "Auth Service is running" });
// });

// // --------- Auth Routes ---------
// app.use("/api/auth", authRoutes);

// // --------- Error Handler ---------
// app.use((err, req, res, next) => {
//   if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
//     console.error("Bad JSON:", err.message);
//     return res.status(400).send({ message: "Invalid JSON payload" });
//   }
//   console.error(err.stack);
//   res.status(500).send("Something broke!");
// });

// // --------- Start Server ---------
// app.listen(PORT, () => {
//   console.log(`Auth Service running on port ${PORT}`);
// });




const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");

dotenv.config();
const authRoutes = require("./src/routes/authRoutes"); // your auth routes
const pool = require("./src/config/db.js"); // your Postgres pool

const app = express();
const PORT = process.env.PORT || 5001;

// --------- CORS Setup ---------
// Allow your frontend origin
// ✅ Allowed origins
const allowedOrigins = ['https://jurinex.netlify.app', 'http://localhost:5173']; // Add your frontend URLs

// ✅ CORS setup
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // Allow non-browser tools like Postman
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

// For preflight OPTIONS requests
app.options('*', cors());
// --------- Middleware ---------
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// --------- Health Check ---------
app.get("/health", (req, res) => {
  res.json({ status: "Auth Service is running" });
});

// --------- Auth Routes ---------
app.use("/api/auth", authRoutes);

// --------- Error Handler ---------
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error("Bad JSON:", err.message);
    return res.status(400).send({ message: "Invalid JSON payload" });
  }
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// --------- Start Server ---------
app.listen(PORT, () => {
  console.log(`Auth Service running on port ${PORT}`);
});
