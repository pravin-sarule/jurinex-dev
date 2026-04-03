/**
 * When SKIP_PAYMENT_SERVICE=true, answers plan/usage endpoints locally so the
 * gateway does not depend on the payment microservice (avoids 504/502 in dev).
 * Register these routes before paymentProxy so they take precedence.
 */
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

const MOCK_ACTIVE_PLAN = {
  plan_id: 0,
  plan_name: "Development",
  description: "Local / internal — payment service bypassed",
  price: 0,
  currency: "USD",
  interval: "month",
  type: "internal",
  token_limit: 999999999,
  carry_over_limit: 0,
  document_limit: 999999,
  ai_analysis_limit: 999999,
  template_access: true,
  storage_limit_gb: 999,
  drafting_type: "full",
  limits: {},
  start_date: null,
  end_date: null,
  subscription_status: "active",
};

function planDetailsHandler(req, res) {
  res.status(200).json({
    activePlan: MOCK_ACTIVE_PLAN,
    resourceUtilization: {
      tokens: {
        remaining: 999999999,
        limit: 999999999,
        total_used: 0,
        percentage_used: 0,
        status: "within_limit",
        cost: 0,
        total_tokens: 0,
      },
      queries: {
        remaining: 999999999,
        limit: 999999999,
        total_used: 0,
        percentage_used: 0,
        status: "within_limit",
      },
      documents: { used: 0, limit: 999999, percentage_used: 0, status: "within_limit" },
      storage: {
        used_gb: 0,
        limit_gb: 999,
        percentage_used: 0,
        status: "within_limit",
      },
      timeLeftUntilReset: "N/A",
    },
    allPlanConfigurations: [{ ...MOCK_ACTIVE_PLAN, id: 0, is_active_plan: true }],
    latestPayment: null,
  });
}

function transactionsHandler(req, res) {
  res.status(200).json({ transactions: [] });
}

function tokenUsageHandler(req, res) {
  res.status(200).json({
    success: true,
    data: {
      tokens_used: 0,
      documents_used: 0,
      ai_analysis_used: 0,
      storage_used_gb: 0,
      carry_over_tokens: 0,
      period_start: null,
      period_end: null,
      updated_at: null,
    },
  });
}

function llmUsageHandler(req, res) {
  res.status(200).json({
    success: true,
    data: {
      logs: [],
      summary: {
        total_requests: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        total_input_cost: 0,
        total_output_cost: 0,
        total_cost: 0,
        unique_models: 0,
      },
      by_model: [],
      active_users: [],
    },
  });
}

function userPlanByIdHandler(req, res) {
  res.status(200).json({ success: true, data: MOCK_ACTIVE_PLAN });
}

/** Document service posts here; no JWT — match payment service behavior */
function llmUsageLogHandler(req, res) {
  res.status(201).json({
    success: true,
    data: {
      id: "mock-skip-payment",
      ...req.body,
    },
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
