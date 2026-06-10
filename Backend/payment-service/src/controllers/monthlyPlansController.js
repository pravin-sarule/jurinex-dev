const Razorpay = require("razorpay");
const crypto = require("crypto");
const db = require("../config/db");
const axios = require("axios");
const { syncUserActivePlanToAuth } = require("../services/userPlanSyncService");
const { sendPurchaseConfirmationEmail } = require("../services/purchaseEmailService");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

/**
 * GET /api/user-resources/monthly-plans
 * Returns all active monthly plans ordered by sort_order.
 */
const getMonthlyPlans = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, price, currency, monthly_tokens,
              storage_limit_gb, is_active, sort_order, razorpay_plan_id, billing_interval_months,
              created_at, updated_at
       FROM monthly_plans
       WHERE is_active = true
       ORDER BY sort_order ASC, price ASC`
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[getMonthlyPlans] error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch monthly plans", error: err.message });
  }
};

/**
 * POST /api/user-resources/monthly-plans/subscribe/start
 * Body: { plan_id }
 * Creates a Razorpay subscription for a monthly_plans entry.
 */
const startMonthlySubscription = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers["x-user-id"];
    const { plan_id } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized: User ID missing." });
    if (!plan_id) return res.status(400).json({ success: false, message: "Missing plan_id." });

    const planResult = await db.query(
      "SELECT * FROM monthly_plans WHERE id = $1 AND is_active = true LIMIT 1",
      [plan_id]
    );
    if (!planResult.rows.length) {
      return res.status(404).json({ success: false, message: "Plan not found or inactive." });
    }
    const plan = planResult.rows[0];

    if (!plan.razorpay_plan_id) {
      // No Razorpay subscription plan — use a one-time order
      const amountPaise = Math.round(Number(plan.price) * 100);
      if (!amountPaise || amountPaise <= 0) {
        return res.status(400).json({ success: false, message: "Plan has no valid price configured." });
      }

      const order = await razorpay.orders.create({
        amount: amountPaise,
        currency: plan.currency || "INR",
        receipt: `mp_${userId}_${Date.now()}`,
        notes: { app_user_id: String(userId), monthly_plan_id: String(plan.id) },
      });

      // Compute end date in JS to avoid PostgreSQL interval type-inference issues
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + (Number(plan.billing_interval_months) || 1));

      // Store pending plan WITHOUT changing the current active status.
      // This ensures the user keeps their existing plan during payment.
      await db.query(
        `INSERT INTO user_subscriptions
           (user_id, monthly_plan_id, status, current_token_balance, topup_token_balance,
            start_date, end_date, activated_at, last_reset_date, created_at, updated_at)
         VALUES ($1, $2, 'active', $3, 0,
                 CURRENT_DATE, $4::DATE,
                 NULL, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           monthly_plan_id = EXCLUDED.monthly_plan_id,
           updated_at      = CURRENT_TIMESTAMP`,
        [userId, plan.id, plan.monthly_tokens || 0, endDate.toISOString().split("T")[0]]
      );

      return res.status(200).json({
        success: true,
        type: "order",
        order: { id: order.id, amount: order.amount, currency: order.currency },
        plan: {
          id: plan.id,
          name: plan.name,
          monthly_tokens: plan.monthly_tokens,
        },
        key: process.env.RAZORPAY_KEY_ID,
      });
    }

    // Fetch user for Razorpay customer creation
    let user = {};
    try {
      const userResp = await axios.get(
        `${process.env.USER_SERVICE_API_URL}/api/auth/users/${userId}`,
        { headers: { Authorization: req.headers["authorization"] } }
      );
      user = userResp.data.user || userResp.data || {};
    } catch (_) {}

    let customerId = user.razorpay_customer_id;
    if (!customerId && user.email) {
      try {
        const customer = await razorpay.customers.create({
          name: user.name || user.username || user.email,
          email: user.email,
          ...(user.phone ? { contact: user.phone } : {}),
        });
        customerId = customer.id;
        await axios.put(
          `${process.env.USER_SERVICE_API_URL}/api/auth/users/${userId}/razorpay-customer-id`,
          { razorpay_customer_id: customerId },
          { headers: { Authorization: req.headers["authorization"] } }
        );
      } catch (cerr) {
        console.warn("[startMonthlySubscription] customer create failed:", cerr.message);
      }
    }

    const totalCount = plan.billing_interval_months > 0 ? Math.ceil(12 / plan.billing_interval_months) : 12;

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.razorpay_plan_id,
      customer_notify: 1,
      quantity: 1,
      total_count: totalCount,
      notes: { app_user_id: String(userId), monthly_plan_id: String(plan.id) },
    });

    await db.query(
      `INSERT INTO user_subscriptions
         (user_id, monthly_plan_id, razorpay_subscription_id, status, current_token_balance,
          topup_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         monthly_plan_id           = EXCLUDED.monthly_plan_id,
         razorpay_subscription_id  = EXCLUDED.razorpay_subscription_id,
         status                    = EXCLUDED.status,
         current_token_balance     = EXCLUDED.current_token_balance,
         updated_at                = CURRENT_TIMESTAMP`,
      [userId, plan.id, subscription.id, subscription.status, plan.monthly_tokens || 0]
    );

    return res.status(200).json({
      success: true,
      type: "subscription",
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_id: plan.id,
        plan_name: plan.name,
        ...(customerId ? { customer_id: customerId } : {}),
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    const detail = err?.error?.description || err?.error?.code || err?.message || "Unknown error";
    console.error("[startMonthlySubscription] error:", detail, err);
    return res.status(500).json({
      success: false,
      message: detail,
      error: detail,
    });
  }
};

/**
 * POST /api/user-resources/monthly-plans/subscribe/verify
 * Verifies Razorpay subscription or one-time order payment, activates the plan.
 */
const verifyMonthlySubscription = async (req, res) => {
  try {
    await db.query("BEGIN");

    const userId = req.user?.id;
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_order_id,
      razorpay_signature,
      plan_id,
    } = req.body;

    if (!userId || !razorpay_payment_id || !razorpay_signature) {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Missing verification data." });
    }

    // Idempotency guard
    const existing = await db.query(
      "SELECT id FROM payments WHERE razorpay_payment_id = $1",
      [razorpay_payment_id]
    );
    if (existing.rows.length) {
      await db.query("COMMIT");
      return res.status(200).json({ success: true, message: "Payment already processed." });
    }

    // Verify signature
    const signBase = razorpay_subscription_id
      ? `${razorpay_payment_id}|${razorpay_subscription_id}`
      : `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(signBase)
      .digest("hex");
    if (expected !== razorpay_signature) {
      await db.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Invalid payment signature." });
    }

    // Resolve plan
    let plan = null;
    if (plan_id) {
      const pr = await db.query("SELECT * FROM monthly_plans WHERE id = $1 LIMIT 1", [plan_id]);
      plan = pr.rows[0] || null;
    }
    if (!plan) {
      const pr = await db.query(
        "SELECT mp.* FROM user_subscriptions us JOIN monthly_plans mp ON mp.id = us.monthly_plan_id WHERE us.user_id = $1 LIMIT 1",
        [userId]
      );
      plan = pr.rows[0] || null;
    }
    if (!plan) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Plan not found." });
    }

    // Fetch payment details
    let paymentDetails = { id: razorpay_payment_id, amount: 0, currency: "INR", status: "captured", method: "unknown", order_id: razorpay_order_id || null };
    try {
      paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (_) {}

    // Activate subscription — UPSERT so it works for new users AND upgrades
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + (plan.billing_interval_months || 1));

    const subResult = await db.query(
      `INSERT INTO user_subscriptions
         (user_id, monthly_plan_id, status, current_token_balance, topup_token_balance,
          start_date, end_date, activated_at, last_reset_date, razorpay_payment_id,
          created_at, updated_at)
       VALUES ($1, $2, 'active', $3, 0,
               CURRENT_DATE, $4::DATE, CURRENT_TIMESTAMP, CURRENT_DATE, $5,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         status                = 'active',
         monthly_plan_id       = EXCLUDED.monthly_plan_id,
         current_token_balance = EXCLUDED.current_token_balance,
         start_date            = EXCLUDED.start_date,
         end_date              = EXCLUDED.end_date,
         activated_at          = CURRENT_TIMESTAMP,
         last_reset_date       = CURRENT_DATE,
         plan_tokens_used      = 0,
         razorpay_payment_id   = EXCLUDED.razorpay_payment_id,
         updated_at            = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, plan.id, plan.monthly_tokens || 0, endDate.toISOString().split("T")[0], razorpay_payment_id]
    );

    const userSub = subResult.rows[0];

    // Record payment
    await db.query(
      `INSERT INTO payments (user_id, subscription_id, razorpay_payment_id, razorpay_order_id,
         razorpay_signature, amount, currency, status, payment_method, created_at, transaction_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,CURRENT_DATE)`,
      [
        userId, userSub.id, paymentDetails.id,
        paymentDetails.order_id || razorpay_order_id,
        razorpay_signature,
        paymentDetails.amount ? paymentDetails.amount / 100 : Number(plan.price || 0),
        paymentDetails.currency || plan.currency || "INR",
        paymentDetails.status || "captured",
        paymentDetails.method || "unknown",
      ]
    );

    await db.query("COMMIT");

    // Sync active plan to auth service (best-effort)
    try {
      await syncUserActivePlanToAuth(userId, {
        plan_id: plan.id, plan_name: plan.name,
        monthly_plan_id: plan.id,
      });
    } catch (_) {}

    sendPurchaseConfirmationEmail({
      to: req.user?.email,
      customerName: req.user?.email ? req.user.email.split("@")[0] : `User ${userId}`,
      customerEmail: req.user?.email,
      planName: plan.name,
      amount: paymentDetails.amount ? paymentDetails.amount / 100 : Number(plan.price || 0),
      currency: paymentDetails.currency || plan.currency || "INR",
      paymentId: paymentDetails.id,
      orderId: paymentDetails.order_id || razorpay_order_id,
      purchaseDate: new Date(),
      transactionType: "Monthly Plan Subscription",
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Monthly plan subscription verified.",
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        monthly_tokens: plan.monthly_tokens,
        billing_interval_months: plan.billing_interval_months,
      },
      subscription: userSub,
      activePlan: {
        plan_id: plan.id,
        plan_name: plan.name,
        monthly_tokens: plan.monthly_tokens,
        billing_interval_months: plan.billing_interval_months,
        price: plan.price,
        currency: plan.currency,
        status: 'active',
      },
    });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error("[verifyMonthlySubscription] error:", err);
    return res.status(500).json({ success: false, message: "Verification failed.", error: err.message });
  }
};

module.exports = { getMonthlyPlans, startMonthlySubscription, verifyMonthlySubscription };
