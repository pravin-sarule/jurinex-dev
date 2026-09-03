# Brevo Contact Sync — Integration Guide

A drop-in, fire-and-forget module that adds every newly registered user to a Brevo contact list, so a Brevo automation (e.g. a Welcome Email) picks them up. No SDK, no queue, no new dependencies — one HTTPS call that can never break your signup flow.

| | |
|---|---|
| **Runtime** | Node ≥ 18 (native `fetch`) |
| **Dependencies** | None |
| **API** | Brevo v3 `POST /contacts` |
| **Failure mode** | Log & continue — never blocks registration |

---

## How it works (30 seconds)

Your app never sends the welcome email itself. It only makes sure the new user's email lands in a specific Brevo **contact list**; a Brevo **automation** configured in the Brevo dashboard watches that list and sends the email. That split keeps email content, timing, and templates editable by non-developers, and keeps your backend's job trivial.

Three rules:

- **Trigger it only when an account is created** — registration endpoints and first-ever social sign-in. Never on plain login.
- **Fire-and-forget:** call it without `await`. The module never throws, times out after 5s, and only logs warnings — a Brevo outage cannot fail or slow a registration.
- **Idempotent:** `updateEnabled: true` means calling twice for the same email updates the contact instead of erroring.

---

## Step 1 — Prepare Brevo

Three things in the Brevo dashboard, all one-time setup:

| What | Where | You need |
|---|---|---|
| API v3 key | Settings → SMTP & API → **API Keys** tab → Generate | A key starting with `xkeysib-` |
| Contact list | Contacts → Lists → Create a list | Its **numeric ID** (shown next to the list name) |
| Automation | Automations → create one with entry condition *"contact added to list \<your list\>"* → add a "Send email" step → **activate it** | Active status |

> ⚠️ **The #1 gotcha — wrong key type.** Brevo has two key families. SMTP keys start with `xsmtpsib-` and are **rejected with 401** by the REST API. The contacts API needs an **API v3 key** (`xkeysib-…`) from the *API Keys* tab, not the SMTP tab. The module warns once at runtime if the prefix looks wrong.

---

## Step 2 — Configure environment

```env
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BREVO_LIST_ID=7
```

| Variable | Required | If missing |
|---|---|---|
| `BREVO_API_KEY` | yes | Sync is silently skipped (safe for local dev) |
| `BREVO_LIST_ID` | yes, for the automation | Contact is still created/updated but joins **no list** — so the automation never fires |

---

## Step 3 — Drop in the module

Copy this file into your project as-is (e.g. `src/services/brevoService.js`). No packages to install — it uses Node's built-in `fetch` and `AbortSignal.timeout` (Node 18+).

```js
// Brevo (formerly Sendinblue) contact sync.
// Adds newly registered users to the Brevo list (BREVO_LIST_ID) so the active
// Welcome Email automation picks them up.
// Fire-and-forget: never throws and never blocks the registration response.

const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';
const REQUEST_TIMEOUT_MS = 5000;

let warnedAboutKeyFormat = false;

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

async function syncContactToBrevo(email, fullName = '') {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey || !email) return;

    // API v3 keys start with "xkeysib-". SMTP keys ("xsmtpsib-...") are
    // rejected by the REST API with 401.
    if (!apiKey.startsWith('xkeysib-') && !warnedAboutKeyFormat) {
      warnedAboutKeyFormat = true;
      console.warn(
        '[Brevo] BREVO_API_KEY does not look like an API v3 key (expected "xkeysib-..."). ' +
        'SMTP keys ("xsmtpsib-...") are rejected by the contacts API — generate an API key ' +
        'in Brevo > Settings > SMTP & API > API Keys.'
      );
    }

    const listId = parseInt(process.env.BREVO_LIST_ID, 10);
    const { firstName, lastName } = splitFullName(fullName);

    const payload = {
      email,
      attributes: {},
      updateEnabled: true, // update the contact if the email already exists
    };
    if (firstName) payload.attributes.FIRSTNAME = firstName;
    if (lastName) payload.attributes.LASTNAME = lastName;
    if (Number.isInteger(listId)) payload.listIds = [listId];

    const response = await fetch(BREVO_CONTACTS_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // 201 = contact created, 204 = existing contact updated
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.warn(`[Brevo] Contact sync failed for ${email}: HTTP ${response.status} ${errorBody}`);
      return;
    }

    console.log(`[Brevo] Contact synced: ${email}`);
  } catch (error) {
    console.warn(`[Brevo] Contact sync error for ${email}:`, error.message);
  }
}

module.exports = { syncContactToBrevo };
```

---

## Step 4 — Call it from your signup paths

One line per account-creation path. Pass the email and whatever display name you have; the module splits it into `FIRSTNAME`/`LASTNAME` itself.

```js
const { syncContactToBrevo } = require('./services/brevoService');

// In each registration / account-creation handler,
// AFTER the user row is created:
syncContactToBrevo(user.email, user.fullName);   // ← no await, on purpose
```

Where to hook it — the pattern used in the reference implementation:

| Account-creation path | Call |
|---|---|
| Standard registration endpoint | `syncContactToBrevo(email, fullName)` |
| Organization/tenant registration (admin account) | `syncContactToBrevo(email, adminName)` |
| Social sign-in (Google etc.) | Only inside the **"user not found → create"** branch — first sign-in creates the account; later sign-ins must not re-trigger |
| Admin-created / invited users | After the user row is created — easy to forget on invite flows |

**Rules of thumb:** call after the DB insert succeeds (don't sync users that failed to register) · never `await` it in the request path · never on login.

---

## Reference — the underlying API call

Everything the module sends — useful if you're implementing this in another language:

```http
POST https://api.brevo.com/v3/contacts
api-key: xkeysib-…              ← header, not Authorization
Content-Type: application/json
Accept: application/json

{
  "email": "user@example.com",          // required
  "attributes": {                        // optional
    "FIRSTNAME": "Ravi",
    "LASTNAME": "Sharma"
  },
  "updateEnabled": true,                 // upsert instead of 400 on duplicates
  "listIds": [7]                         // the list your automation watches
}
```

| Status | Meaning | Handle as |
|---|---|---|
| 201 | Contact created | Success |
| 204 | Existing contact updated (added to list) | Success |
| 400 | Malformed email / bad payload | Log & continue |
| 401 | Bad key — usually an `xsmtpsib-` SMTP key | Fix the key type (Step 1) |
| 429 | Rate limited | Log & continue (signup volume rarely hits this) |

Attribute names (`FIRSTNAME`, `LASTNAME`) must match the contact attributes defined in your Brevo account — those two exist by default. Add more (e.g. `SMS`, custom fields) the same way if your templates need them.

---

## Step 5 — Test it end to end

**1.** Verify the key and list directly, before touching your app:

```bash
curl -X POST https://api.brevo.com/v3/contacts \
  -H "api-key: $BREVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"synctest@example.com","attributes":{"FIRSTNAME":"Sync","LASTNAME":"Test"},"updateEnabled":true,"listIds":[7]}'
```

Expect an empty `201`/`204`. Then check Brevo → Contacts: the address should be in your list, and (if the automation is active) the welcome email should arrive within a minute or two.

**2.** Register a test user through your app and watch the service logs for `[Brevo] Contact synced: …` or a `[Brevo] Contact sync failed` warning.

---

## Troubleshooting — when the email doesn't arrive

| Symptom | Cause | Fix |
|---|---|---|
| No `[Brevo]` log lines at all | `BREVO_API_KEY` unset, or the call site was never reached | Set the env var; confirm the handler calls `syncContactToBrevo` after the insert |
| `HTTP 401` in logs | SMTP key (`xsmtpsib-…`) used instead of an API v3 key | Generate an `xkeysib-` key under the **API Keys** tab |
| Contact appears in Brevo but no email | Contact isn't in the list (bad/missing `BREVO_LIST_ID`), or the automation is inactive / watches a different list | Check the numeric list ID; open the automation and confirm it's **Active** and its entry condition targets that list |
| Existing users don't get the email on re-registration | Expected — the automation's entry condition fires when a contact *enters* the list; re-entry rules are governed by the automation's settings | Adjust "allow contacts to re-enter" in the automation if you want repeats |
| Sync times out in logs | Network egress to `api.brevo.com` blocked | Allow outbound HTTPS; registration itself is unaffected by design |

---

*Reference implementation: JuriNex `Backend/authservice/src/services/brevoService.js` · 2026-08-26*
