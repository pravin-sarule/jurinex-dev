# Billing & Usage — Data Sources Reference

> **Audience:** New developers onboarding to the JuriNex backend.  
> **Purpose:** Every data point shown on the Billing & Usage page (`BillingAndUsagePage.jsx`) is documented here — which database, which table, and the exact SQL query that fetches it.

---

## Database Connection Map

| Alias | Environment Variable | Used for |
|---|---|---|
| `Payment_DB` | `DATABASE_URL` | Plans, subscriptions, token quotas, payments, LLM usage logs |
| `Document_DB` | `DOCUMENT_DATABASE_URL` | User files, chat sessions, embedding vectors |
| `Draft_DB` | `DRAFT_DATABASE_URL` | AI-generated legal documents |
| `Citation_DB` | `CITATION_DATABASE_URL` | Legal research / citation reports |

---

## Tab 1 — Token Usage

**Frontend component:** `BillingAndUsagePage.jsx` → `tab === 'usage'`  
**Backend handler:** `Backend/payment-service/src/controllers/topupController.js` → `getDailyTokenStatus()`  
**API endpoint:** `GET /api/payments/token-quota-status`

### Query 1 — Tokens used today (IST calendar day)

**Database:** `Payment_DB`  
**Table:** `public.llm_usage_logs`  
**UI fields populated:** `tokens_used_today`

```sql
SELECT
  COALESCE(
    SUM(total_tokens) FILTER (
      WHERE (used_at AT TIME ZONE 'Asia/Kolkata')::date
            = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    ),
    0
  )::bigint AS tokens_today,
  COALESCE(SUM(total_tokens), 0)::bigint AS tokens_all_time
FROM public.llm_usage_logs
WHERE user_id::text = $1
-- $1 = authenticated user_id
```

---

### Query 2 — Active subscription, plan limits, top-up balance

**Database:** `Payment_DB`  
**Tables:** `user_subscriptions` JOIN `monthly_plans` JOIN `subscription_plans`  
**UI fields populated:** `plan_name`, `monthly_token_limit`, `topup_token_balance`, `billing_period_start`, `monthly_plan_id`

```sql
SELECT
  us.topup_token_balance,
  COALESCE(us.last_reset_date, us.start_date)      AS billing_period_start,
  COALESCE(mp.monthly_tokens, sp.token_limit, 0)   AS monthly_tokens,
  COALESCE(mp.name, sp.name)                        AS plan_name,
  mp.id                                             AS monthly_plan_id
FROM user_subscriptions us
LEFT JOIN monthly_plans mp       ON mp.id = us.monthly_plan_id
LEFT JOIN subscription_plans sp  ON sp.id = us.plan_id
WHERE us.user_id = $1
  AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
  AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
ORDER BY us.updated_at DESC
LIMIT 1
-- $1 = authenticated user_id
-- Prefers monthly_plans (new flow); falls back to subscription_plans (legacy)
```

---

### Query 3 — Tokens consumed this billing cycle

**Database:** `Payment_DB`  
**Table:** `public.llm_usage_logs`  
**UI fields populated:** `tokens_used_this_period`, `Used Period`, `Remaining`

```sql
SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_period
FROM public.llm_usage_logs
WHERE user_id::text = $1
  AND used_at >= $2::timestamptz
-- $1 = user_id
-- $2 = billing_period_start (last_reset_date or start_date from user_subscriptions)
```

---

### Derived values (computed in Node.js, not SQL)

| UI Label | Computation |
|---|---|
| **Plan Tokens Left** | `monthly_tokens - plan_tokens_used` |
| **Top-up Balance** | `topup_token_balance` (zeroed if `topup_expires_at < NOW()`) |
| **Total Available** | `plan_tokens_left + topup_balance` |
| **Remaining** | `monthly_tokens - tokens_used_this_period` |
| **Token source** | `'plan'` / `'topup'` / `'unlimited'` / `'none'` — computed in `tokenQuotaCheckService.js` |

---

## Tab 2 — Storage

**Frontend component:** `BillingAndUsagePage.jsx` → `tab === 'storage'` → `StorageTab`  
**Backend handler:** `Backend/payment-service/src/controllers/storageController.js` → `getUserStorageUsage()`  
**Backend service:** `Backend/payment-service/src/services/storageStatsService.js` → `calculateUserStorage()`  
**API endpoint (primary):** `GET /api/storage/usage`  
**API endpoint (fallback):** `GET /api/chat/storage/usage` (ChatModel service — hits Document_DB directly)

---

### Query 1 — File storage broken down by service

**Database:** `Document_DB`  
**Table:** `user_files`  
**UI fields populated:** `Documents` row — Chat uploads, Case documents, Draft attachments, Other

```sql
SELECT
  COUNT(*)::int                                                         AS file_count,
  COALESCE(SUM(size), 0)::bigint                                        AS files_bytes,

  -- Chat Model uploads  (gcs_path prefix: chat-uploads/)
  COALESCE(SUM(size) FILTER (WHERE gcs_path LIKE 'chat-uploads/%'), 0)::bigint
                                                                        AS chat_model_bytes,
  COUNT(*) FILTER (WHERE gcs_path LIKE 'chat-uploads/%')::int          AS chat_model_count,

  -- Document Service    (gcs_path prefix: {userId}/documents/)
  COALESCE(SUM(size) FILTER (
    WHERE gcs_path ~ ('^' || user_id || '/documents/')
  ), 0)::bigint                                                         AS doc_service_bytes,
  COUNT(*) FILTER (WHERE gcs_path ~ ('^' || user_id || '/documents/'))::int
                                                                        AS doc_service_count,

  -- Draft Service       (gcs_path prefix: uploads/)
  COALESCE(SUM(size) FILTER (WHERE gcs_path LIKE 'uploads/%'), 0)::bigint
                                                                        AS draft_service_bytes,
  COUNT(*) FILTER (WHERE gcs_path LIKE 'uploads/%')::int               AS draft_service_count,

  -- Other (everything else)
  COALESCE(SUM(size) FILTER (
    WHERE gcs_path NOT LIKE 'chat-uploads/%'
      AND NOT (gcs_path ~ ('^' || user_id || '/documents/'))
      AND gcs_path NOT LIKE 'uploads/%'
  ), 0)::bigint                                                         AS other_bytes,
  COUNT(*) FILTER (
    WHERE gcs_path NOT LIKE 'chat-uploads/%'
      AND NOT (gcs_path ~ ('^' || user_id || '/documents/'))
      AND gcs_path NOT LIKE 'uploads/%'
  )::int                                                                AS other_count

FROM user_files
WHERE user_id = $1
  AND (is_folder IS NULL OR is_folder = FALSE)
-- $1 = user_id (string)
```

---

### Query 2 — Conversations (chat + question text size)

**Database:** `Document_DB`  
**Table:** `file_chats`  
**UI fields populated:** `Conversations` row

```sql
SELECT
  COUNT(*)::int                                                      AS chat_count,
  COALESCE(SUM(
    OCTET_LENGTH(COALESCE(question, '')) +
    OCTET_LENGTH(COALESCE(answer,   ''))
  ), 0)::bigint                                                      AS chat_bytes,
  COALESCE(SUM(OCTET_LENGTH(COALESCE(question, ''))), 0)::bigint    AS question_bytes
FROM file_chats
WHERE user_id = $1
-- $1 = user_id
```

---

### Query 3 — Smart Search Index (embedding vectors)

**Database:** `Document_DB`  
**Tables:** `chunk_vectors` JOIN `user_files`  
**UI fields populated:** `Smart Search Index` row  
**Storage formula:** `embedding_count × 768 dimensions × 4 bytes/float32`

```sql
SELECT COUNT(*)::int AS embedding_count
FROM chunk_vectors cv
JOIN user_files uf ON cv.file_id = uf.id
WHERE uf.user_id = $1
-- $1 = user_id
-- Actual byte cost computed in Node.js:
--   embeddingBytes = embedding_count * 768 * 4
```

---

### Query 4 — Generated Drafts

**Database:** `Draft_DB`  
**Tables:** `generated_documents` JOIN `user_drafts`  
**UI fields populated:** `Generated Drafts` row

```sql
SELECT
  COUNT(gd.document_id)::int             AS draft_count,
  COALESCE(SUM(gd.file_size), 0)::bigint AS draft_bytes
FROM generated_documents gd
JOIN user_drafts ud ON gd.draft_id = ud.draft_id
WHERE ud.user_id::text = $1
-- $1 = user_id
```

---

### Query 5 — Legal Research (citation reports)

**Database:** `Citation_DB`  
**Table:** `citation_reports`  
**UI fields populated:** `Legal Research` row

```sql
SELECT
  COUNT(*)::int                                                            AS citation_count,
  COALESCE(SUM(
    OCTET_LENGTH(COALESCE(query,         '')) +
    OCTET_LENGTH(COALESCE(report_format::text, ''))
  ), 0)::bigint                                                            AS citation_bytes
FROM citation_reports
WHERE user_id = $1
-- $1 = user_id
```

---

### Query 6 — Storage Limit (primary — monthly_plans)

**Database:** `Payment_DB`  
**Tables:** `user_subscriptions` JOIN `monthly_plans`  
**UI fields populated:** Plan storage quota, progress bar limit

```sql
SELECT mp.storage_limit_gb
FROM user_subscriptions us
JOIN monthly_plans mp ON us.monthly_plan_id = mp.id
WHERE us.user_id = $1
  AND us.status = 'active'
LIMIT 1
-- $1 = user_id
```

---

### Query 7 — Storage Limit (legacy fallback — subscription_plans)

**Database:** `Payment_DB`  
**Tables:** `user_subscriptions` JOIN `subscription_plans`

```sql
SELECT sp.storage_limit_gb
FROM user_subscriptions us
JOIN subscription_plans sp ON us.plan_id = sp.id
WHERE us.user_id = $1
  AND us.status = 'active'
LIMIT 1
-- $1 = user_id
-- Only runs when Query 6 returns no rows
```

---

## Tab 3 — Payments

**Frontend component:** `BillingAndUsagePage.jsx` → `tab === 'history'`  
**Backend handler:** `Backend/payment-service/src/controllers/paymentController.js` → `getUserPaymentHistory()`  
**API endpoint:** `GET /api/payments/history`

### Query — Full payment history

**Database:** `Payment_DB`  
**Tables:** `payments` LEFT JOIN `user_subscriptions` LEFT JOIN `subscription_plans`  
**UI fields populated:** Date, Description (plan name), Amount, Status, Payment method

```sql
SELECT
  p.id                       AS payment_id,
  p.razorpay_payment_id,
  p.razorpay_order_id,
  p.amount,
  p.currency,
  p.status                   AS payment_status,
  p.payment_method,
  p.created_at               AS payment_date,
  p.transaction_date,

  us.id                      AS user_subscription_id,
  us.status                  AS subscription_status,
  us.start_date,
  us.end_date,

  sp.id                      AS plan_id,
  sp.name                    AS plan_name,
  sp.description             AS plan_description,
  sp.price                   AS plan_price,
  sp.interval                AS plan_interval,
  sp.token_limit             AS plan_token_limit

FROM payments p
LEFT JOIN user_subscriptions us ON p.subscription_id = us.id
LEFT JOIN subscription_plans sp ON us.plan_id        = sp.id
WHERE p.user_id = $1
ORDER BY p.created_at DESC, p.id DESC
-- $1 = authenticated user_id
```

---

## Tab 4 — Overview

**Frontend component:** `BillingAndUsagePage.jsx` → `tab === 'overview'`  
**Backend handler:** `Backend/payment-service/src/controllers/userResourcesController.js` → `getPlanAndResourceDetails()`  
**API endpoint:** `GET /api/user-resources/plan-details` (via `USER_RESOURCES_SERVICE_URL`)

This tab aggregates data from multiple sources:

| Section | Source |
|---|---|
| Active plan card | `effectivePlanService.js` — queries `user_subscriptions` JOIN `monthly_plans` / `subscription_plans` |
| Latest payment | `payments` table — `ORDER BY created_at DESC LIMIT 1` |
| Token utilization | `llm_usage_logs` — `SUM(total_tokens)` since `billing_period_start` |
| Storage utilization | Storage service (same as Storage tab) |
| All plan configs | `subscription_plans` — full table scan ordered by price |

---

## Tab 5 — AI Usage

**Frontend component:** `LLMUsageComponent` (imported into `BillingAndUsagePage.jsx`)  
**Source file:** `frontend/src/components/LLMUsageComponent.jsx`  
**Backend:** Queries `llm_usage_logs` (Payment_DB) with model-level breakdown.

---

## Key Backend Files

| File | Role |
|---|---|
| `Backend/payment-service/src/controllers/topupController.js` | Token quota status endpoint |
| `Backend/payment-service/src/controllers/storageController.js` | Storage usage endpoint |
| `Backend/payment-service/src/services/storageStatsService.js` | Cross-DB storage aggregation |
| `Backend/payment-service/src/controllers/paymentController.js` | Payment history endpoint |
| `Backend/payment-service/src/controllers/userResourcesController.js` | Overview plan + resource details |
| `Backend/payment-service/src/services/tokenQuotaCheckService.js` | Central token quota logic (used by all services) |
| `Backend/payment-service/src/services/effectivePlanService.js` | Resolves active plan (monthly_plans vs legacy subscription_plans) |
