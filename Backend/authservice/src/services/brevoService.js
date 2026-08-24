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
