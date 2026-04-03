/**
 * Chat Model service instruction: base text from `system_prompts` where `prompt_type = 'chat_model'`,
 * plus profile appendix. Falls back to a hardcoded default if no row or DB error.
 */
const pool = require('../config/db');

const PROMPT_TYPE_CHAT_MODEL = 'chat_model';

/** Used only when DB has no `chat_model` row or prompt is empty. */
const DEFAULT_CHAT_MODEL_BASE_PROMPT = `You are JuriNex Legal Assistant — an expert AI assistant strictly specialised in legal matters.

DOMAIN RESTRICTION:
- You ONLY answer questions related to law, legal concepts, legal procedures, contracts, regulations, case law, statutes, compliance, legal rights, legal strategy, or legal research.
- You MAY answer questions about the user's own profile details since the complete profile is provided to you above.
- If a question is outside the legal domain and is not about the user's profile, politely decline and explain that you are a legal-only assistant.

RESPONSE QUALITY:
- Provide accurate, well-reasoned legal information.
- Responses are for informational purposes only and not a substitute for formal legal advice from a licensed attorney.
- Cite relevant statutes, regulations, or case law where appropriate.
- Address the user by name.`;

function buildProfileAppendix(userProfile) {
  const professional = userProfile?.professional || {};
  const basic = userProfile?.basic || {};
  const ns = (v) => v || 'Not set';
  const name =
    basic.username || professional.fullname || basic.email || professional.email || 'the user';

  return `\n\nUSER PROFILE (complete profile fetched from JuriNex auth service):
- Name: ${name}
- Email: ${ns(basic.email || professional.email)}
- Role: ${ns(professional.primary_role)}
- Organization: ${ns(professional.organization_name)}
- Organization Type: ${ns(professional.organization_type)}
- Primary Jurisdiction: ${ns(professional.primary_jurisdiction)}
- Areas of Practice: ${ns(professional.main_areas_of_practice)}
- Experience: ${ns(professional.experience)}
- Bar Enrollment Number: ${ns(professional.bar_enrollment_number)}
- Typical Client: ${ns(professional.typical_client)}
- Preferred Tone: ${ns(professional.preferred_tone)}
- Detail Level: ${ns(professional.preferred_detail_level)}
- Citation Style: ${ns(professional.citation_style)}

IMPORTANT: When the user asks about their profile details, list ALL the above fields exactly as shown, including those marked "Not set". Never say you do not have access to their profile — the complete profile is provided above. "Not set" means the user has not filled in that field yet.`;
}

async function getChatModelBasePromptFromDb() {
  try {
    const r = await pool.query(
      `SELECT system_prompt FROM system_prompts WHERE prompt_type = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [PROMPT_TYPE_CHAT_MODEL]
    );
    const t = r.rows[0]?.system_prompt;
    if (t && String(t).trim()) {
      console.log('[ChatModelSystemPrompt] Using system_prompts row (prompt_type=chat_model)');
      return String(t).trim();
    }
  } catch (err) {
    if (err && err.code === '42703') {
      console.warn('[ChatModelSystemPrompt] prompt_type column missing; trying legacy single-row fetch');
      try {
        const r2 = await pool.query(
          `SELECT system_prompt FROM system_prompts ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`
        );
        const t2 = r2.rows[0]?.system_prompt;
        if (t2 && String(t2).trim()) {
          console.log('[ChatModelSystemPrompt] Using latest system_prompts row (no prompt_type column)');
          return String(t2).trim();
        }
      } catch (e2) {
        console.warn('[ChatModelSystemPrompt] Legacy fetch failed:', e2.message);
      }
    } else {
      console.warn('[ChatModelSystemPrompt] DB read failed:', err.message);
    }
  }
  console.log('[ChatModelSystemPrompt] No suitable row; using hardcoded default base');
  return DEFAULT_CHAT_MODEL_BASE_PROMPT;
}

/**
 * Full Vertex system instruction: DB (or default) base + user profile appendix.
 */
async function buildChatModelSystemInstruction(userProfile) {
  const base = await getChatModelBasePromptFromDb();
  return `${base}${buildProfileAppendix(userProfile)}`;
}

module.exports = {
  PROMPT_TYPE_CHAT_MODEL,
  DEFAULT_CHAT_MODEL_BASE_PROMPT,
  buildProfileAppendix,
  getChatModelBasePromptFromDb,
  buildChatModelSystemInstruction,
};
