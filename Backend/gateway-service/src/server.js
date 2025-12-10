// // Entry point
// const app = require("./app");

// const PORT = process.env.PORT || 5000;

// app.listen(PORT, () => {
//   console.log(`API Gateway running on port ${PORT}`);
// });
// src/server.js
const app = require("./app");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
});
