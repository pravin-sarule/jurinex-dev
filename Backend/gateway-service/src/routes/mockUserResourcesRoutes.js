/**
 * When SKIP_PAYMENT_SERVICE=true, forward user-resources to the real payment service when
 * it is reachable. Only returns empty/mock payloads if payment is down.
 */
const express = require("express");
const axios = require("axios");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

const PAYMENT_BASE = (process.env.PAYMENT_SERVICE_URL || "http://localhost:5003").replace(/\/$/, "");

function paymentHeaders(req) {
  const headers = { "Content-Type": "application/json" };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }
  if (req.user?.id) {
    headers["x-user-id"] = String(req.user.id);
  }
  return headers;
}

async function forwardToPayment(req, res, apiPath) {
  const url = `${PAYMENT_BASE}/api/user-resources${apiPath}`;
  try {
    const resp = await axios({
      method: req.method,
      url,
      headers: paymentHeaders(req),
      params: req.query,
      data: req.body,
      timeout: 10000,
      validateStatus: () => true,
    });
    res.status(resp.status).json(resp.data);
    return true;
  } catch (error) {
    console.warn(`[Gateway] Payment forward failed ${url}:`, error.message);
    return false;
  }
}

function emptyPlanDetails() {
  return {
    activePlan: null,
    resourceUtilization: {
      tokens: { remaining: 0, limit: 0, total_used: 0, percentage_used: 0, status: "no_plan" },
      queries: { remaining: 0, limit: 0, total_used: 0, percentage_used: 0, status: "no_plan" },
      documents: { used: 0, limit: 0, percentage_used: 0, status: "no_plan" },
      storage: {
        used_gb: 0,
        limit_gb: 0,
        percentage_used: 0,
        status: "no_plan",
        note: "Payment service unavailable.",
      },
      timeLeftUntilReset: "N/A",
    },
    allPlanConfigurations: [],
    latestPayment: null,
  };
}

async function planDetailsHandler(req, res) {
  if (await forwardToPayment(req, res, "/plan-details")) return;
  return res.status(200).json(emptyPlanDetails());
}

async function transactionsHandler(req, res) {
  if (await forwardToPayment(req, res, "/transactions")) return;
  return res.status(200).json({ transactions: [] });
}

async function tokenUsageHandler(req, res) {
  if (await forwardToPayment(req, res, "/token-usage")) return;
  return res.status(200).json({ success: true, data: { tokens_used: 0, documents_used: 0 } });
}

async function llmUsageHandler(req, res) {
  if (await forwardToPayment(req, res, "/llm-usage")) return;
  return res.status(200).json({ success: true, data: { logs: [], summary: {} } });
}

async function userPlanByIdHandler(req, res) {
  const userId = req.params.userId;
  if (await forwardToPayment(req, res, `/user-plan/${userId}`)) return;
  return res.status(404).json({ success: false, message: "No active plan found for this user." });
}

function llmUsageLogHandler(req, res) {
  const url = `${PAYMENT_BASE}/api/user-resources/llm-usage-log`;
  axios
    .post(url, req.body, { headers: paymentHeaders(req), timeout: 10000, validateStatus: () => true })
    .then((resp) => res.status(resp.status).json(resp.data))
    .catch((err) => {
      console.warn("[Gateway] llm-usage-log forward failed:", err.message);
      res.status(201).json({ success: true, data: { id: "mock-skip-payment", ...req.body } });
    });
}

const withAuth = [
  ["/user-resources/plan-details", planDetailsHandler],
  ["/user-resources/transactions", transactionsHandler],
  ["/user-resources/token-usage", tokenUsageHandler],
  ["/user-resources/llm-usage", llmUsageHandler],
  ["/user-resources/user-plan/:userId", userPlanByIdHandler],
];

withAuth.forEach(([path, handler]) => {
  router.get(path, authMiddleware, handler);
});

const withAuthApiPrefix = [
  ["/api/user-resources/plan-details", planDetailsHandler],
  ["/api/user-resources/transactions", transactionsHandler],
  ["/api/user-resources/token-usage", tokenUsageHandler],
  ["/api/user-resources/llm-usage", llmUsageHandler],
  ["/api/user-resources/user-plan/:userId", userPlanByIdHandler],
];

withAuthApiPrefix.forEach(([path, handler]) => {
  router.get(path, authMiddleware, handler);
});

router.post("/api/user-resources/llm-usage-log", llmUsageLogHandler);

module.exports = router;
