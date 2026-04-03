const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';

/**
 * Calls GET /api/auth/professional-profile which returns:
 * {
 *   fullname, email, phone,           ← from users table
 *   primary_role, organization_name, primary_jurisdiction,
 *   main_areas_of_practice, experience, typical_client,
 *   preferred_tone, preferred_detail_level, citation_style,
 *   perspective, highlights_in_summary, organization_type,
 *   bar_enrollment_number, is_profile_completed, ...
 * }
 */
async function fetchCompleteProfile(authorizationHeader) {
  const response = await axios.get(
    `${AUTH_SERVICE_URL}/api/auth/professional-profile`,
    {
      headers: { Authorization: authorizationHeader, 'Content-Type': 'application/json' },
      timeout: 5000,
    }
  );
  // Response shape: { type, message, data: { fullname, email, phone, ...profile } }
  return response.data?.data || null;
}

class UserProfileService {
  /**
   * Returns basic user object { username, email, ... } or null.
   * Used by legacy document-upload flow.
   */
  static async getUserProfile(userId, authorizationHeader) {
    try {
      const response = await axios.get(`${AUTH_SERVICE_URL}/api/auth/profile`, {
        headers: { Authorization: authorizationHeader, 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      const user = response.data?.user || null;
      if (user) {
        console.log(`[UserProfileService] ✅ getUserProfile — username: ${user.username || 'N/A'}`);
      }
      return user;
    } catch (error) {
      console.warn(`[UserProfileService] ⚠️ getUserProfile failed:`, error.response?.status || error.message);
      return null;
    }
  }

  /**
   * Fetches the complete user profile from /api/auth/professional-profile.
   * That single endpoint returns basic info (fullname, email, phone) AND
   * all professional profile fields in one call.
   *
   * Returns { basic, professional } for backwards compatibility with
   * buildLegalSystemPrompt / buildUserContextFromProfile.
   */
  static async getFullProfile(userId, authorizationHeader) {
    try {
      const data = await fetchCompleteProfile(authorizationHeader);

      if (!data) {
        console.warn(`[UserProfileService] ⚠️ professional-profile returned empty data for user ${userId}`);
        return { basic: null, professional: null };
      }

      // Split into basic and professional so existing callers work unchanged
      const basic = {
        username: data.fullname || null,
        email:    data.email    || null,
        phone:    data.phone    || null,
      };

      // Everything else is the professional profile
      const professional = { ...data };

      console.log(`[UserProfileService] ✅ Complete profile loaded for user ${userId}:`);
      console.log(`   - name          : ${basic.username || 'N/A'}`);
      console.log(`   - email         : ${basic.email    || 'N/A'}`);
      console.log(`   - role          : ${professional.primary_role           || 'N/A'}`);
      console.log(`   - org           : ${professional.organization_name      || 'N/A'}`);
      console.log(`   - jurisdiction  : ${professional.primary_jurisdiction   || 'N/A'}`);
      console.log(`   - areas         : ${professional.main_areas_of_practice || 'N/A'}`);
      console.log(`   - experience    : ${professional.experience             || 'N/A'}`);
      console.log(`   - tone          : ${professional.preferred_tone         || 'N/A'}`);
      console.log(`   - detail level  : ${professional.preferred_detail_level || 'N/A'}`);

      return { basic, professional };
    } catch (error) {
      console.error(`[UserProfileService] ❌ getFullProfile failed for user ${userId}:`, error.response?.status || error.message);
      return { basic: null, professional: null };
    }
  }
}

module.exports = UserProfileService;
