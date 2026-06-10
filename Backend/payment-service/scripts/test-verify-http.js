require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const userId = 76;
const orderId = process.argv[2] || "order_SwFjPo2j5Jmf9h";
const paymentId = process.argv[3] || "pay_diag_test_001";
const planId = Number(process.argv[4] || 5);

const secret = process.env.RAZORPAY_SECRET;
if (!secret) {
  console.error("RAZORPAY_SECRET missing");
  process.exit(1);
}

const signature = crypto
  .createHmac("sha256", secret)
  .update(`${orderId}|${paymentId}`)
  .digest("hex");

const token = jwt.sign(
  { id: userId, email: "diag@test.local", role: "user" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

async function main() {
  const res = await fetch("http://localhost:5003/api/payments/topup/order/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      topup_plan_id: planId,
    }),
  });
  const text = await res.text();
  console.log("HTTP", res.status);
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
