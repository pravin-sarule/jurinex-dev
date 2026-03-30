const express = require("express");
const cors = require("cors");
const config = require("./config");
const chatDraftRoutes = require("./routes/chatDraftRoutes");

const app = express();

app.use(
  cors({
    origin: config.corsOrigins === "*" ? true : config.corsOrigins.split(",").map((v) => v.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "chat-draft-backend" });
});

app.use("/api/chat-draft", chatDraftRoutes);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`chat-draft-backend running on port ${config.port}`);
});
