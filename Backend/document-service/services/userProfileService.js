const axios = require('axios');

/**
 * Service to fetch user professional profile from Auth Service
 * Since auth service and document service have different databases,
 * we need to make API calls to fetch the profile data.
 */
class UserProfileService {
  /**
   * Get user's full name from users table
   * @param {number} userId - User ID
   * @param {string} authorizationHeader - Authorization header (Bearer token)
   * @returns {Promise<string|null>} - User's full name or null
   */
  static async getUserName(userId, authorizationHeader) {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
      const gatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:5000';
      
      const endpoints = [];
      if (process.env.AUTH_SERVICE_URL || !process.env.API_GATEWAY_URL) {
        endpoints.push(`${authServiceUrl}/api/auth/profile`);
      }
      if (process.env.API_GATEWAY_URL) {
        endpoints.push(`${gatewayUrl}/auth/profile`);
      }
      
      if (endpoints.length === 0) {
        endpoints.push(`${authServiceUrl}/api/auth/profile`);
      }

      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint, {
            headers: {
              Authorization: authorizationHeader,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          });
          
          const userName = response.data?.user?.username;
          if (userName) {
            console.log(`[UserProfileService] ✅ Successfully fetched user name: ${userName}`);
            return userName;
          }
        } catch (error) {
          console.warn(`[UserProfileService] Failed to fetch user name from ${endpoint}:`, error.response?.status || error.message);
          lastError = error;
          continue;
        }
      }
      
      console.warn(`[UserProfileService] ⚠️ Could not fetch user name. Last error:`, lastError?.response?.status || lastError?.message);
      return null;
    } catch (error) {
      console.error(`[UserProfileService] ❌ Unexpected error fetching user name for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Get professional profile context string for AI prompts
   * @param {number} userId - User ID
   * @param {string} authorizationHeader - Authorization header (Bearer token)
   * @returns {Promise<string|null>} - Profile context string or null
   */
  static async getProfileContext(userId, authorizationHeader) {
    try {
      // Fetch user's full name first
      const userName = await this.getUserName(userId, authorizationHeader);
      
      // Try multiple endpoints in order: direct auth service first (most reliable for local dev)
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
      const gatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:5000';
      
      // Try direct auth service first (more reliable, especially for local development)
      // Only use gateway if AUTH_SERVICE_URL is not set
      const endpoints = [];
      if (process.env.AUTH_SERVICE_URL || !process.env.API_GATEWAY_URL) {
        // Prefer direct auth service connection
        endpoints.push(`${authServiceUrl}/api/auth/professional-profile`);
      }
      if (process.env.API_GATEWAY_URL) {
        // Add gateway as fallback if explicitly configured
        endpoints.push(`${gatewayUrl}/auth/professional-profile`);
      }
      
      // If no endpoints configured, default to direct auth service
      if (endpoints.length === 0) {
        endpoints.push(`${authServiceUrl}/api/auth/professional-profile`);
      }
      
      console.log(`[UserProfileService] Will try ${endpoints.length} endpoint(s) for user ${userId}`);

      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          console.log(`[UserProfileService] Attempting to fetch profile from: ${endpoint}`);
          const response = await axios.get(endpoint, {
            headers: {
              Authorization: authorizationHeader,
              'Content-Type': 'application/json'
            },
            timeout: 5000 // 5 second timeout
          });
          
          console.log(`[UserProfileService] ✅ Successfully fetched profile from: ${endpoint}`);

          const profile = response.data?.data;
          
          if (!profile || !profile.is_profile_completed) {
            console.log(`[UserProfileService] Profile not completed for user ${userId}`);
            return null;
          }

          // Build context string from profile data
          const contextParts = [];

          // Always include user's name first if available
          if (userName) {
            contextParts.push(`User Full Name: ${userName}`);
          }

          if (profile.primary_role) {
            contextParts.push(`Primary Role: ${profile.primary_role}`);
          }
          if (profile.experience) {
            contextParts.push(`Experience: ${profile.experience}`);
          }
          if (profile.primary_jurisdiction) {
            contextParts.push(`Primary Jurisdiction: ${profile.primary_jurisdiction}`);
          }
          if (profile.main_areas_of_practice) {
            contextParts.push(`Main Areas of Practice: ${profile.main_areas_of_practice}`);
          }
          if (profile.organization_name) {
            contextParts.push(`Organization: ${profile.organization_name}`);
          }
          if (profile.organization_type) {
            contextParts.push(`Organization Type: ${profile.organization_type}`);
          }
          if (profile.preferred_tone) {
            contextParts.push(`Preferred Tone: ${profile.preferred_tone}`);
          }
          if (profile.preferred_detail_level) {
            contextParts.push(`Preferred Detail Level: ${profile.preferred_detail_level}`);
          }
          if (profile.citation_style) {
            contextParts.push(`Citation Style: ${profile.citation_style}`);
          }
          if (profile.perspective) {
            contextParts.push(`Perspective: ${profile.perspective}`);
          }
          if (profile.typical_client) {
            contextParts.push(`Typical Client: ${profile.typical_client}`);
          }
          if (profile.highlights_in_summary) {
            contextParts.push(`Summary Highlights: ${profile.highlights_in_summary}`);
          }

          if (contextParts.length === 0) {
            return null;
          }

          // Build context string with name first and instructions to use it
          let contextString = `=== USER PROFESSIONAL PROFILE ===
The following is the authenticated user's professional profile information. Use this context to personalize your responses and answer questions about the user's profile:

${contextParts.join('\n')}

IMPORTANT INSTRUCTIONS:
- When the user asks about their professional profile, legal credentials, or personal information, you should use the information provided above to answer their questions directly. This is their own profile data that they have provided to the system.
${userName ? `- ALWAYS address the user by their name "${userName}" at the beginning of your responses. For example: "${userName}, your query answer is following..." or "${userName}, here is the information you requested..."` : ''}

---`;
          console.log(`[UserProfileService] Profile context generated for user ${userId}${userName ? ` (Name: ${userName})` : ''}`);
          return contextString;
        } catch (error) {
          console.warn(`[UserProfileService] Failed to fetch from ${endpoint}:`, error.response?.status || error.message);
          lastError = error;
          continue; // Try next endpoint
        }
      }
      
      // If all endpoints failed
      console.error(`[UserProfileService] ❌ All endpoints failed. Last error:`, lastError?.response?.status || lastError?.message);
      return null;
    } catch (error) {
      // Don't fail the request if profile fetch fails
      console.error(`[UserProfileService] ❌ Unexpected error fetching profile for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Get detailed profile context for answering profile questions
   * @param {number} userId - User ID
   * @param {string} authorizationHeader - Authorization header
   * @returns {Promise<string|null>} - Detailed profile context or null
   */
  static async getDetailedProfileContext(userId, authorizationHeader) {
    try {
      // Fetch user's full name first
      const userName = await this.getUserName(userId, authorizationHeader);
      
      console.log(`[UserProfileService] Fetching detailed profile for user ${userId}...`);
      const profile = await this.getProfile(userId, authorizationHeader);
      console.log(`[UserProfileService] Profile fetch result:`, profile ? `Found (completed: ${profile.is_profile_completed})` : 'Not found');
      
      if (!profile || !profile.is_profile_completed) {
        console.log(`[UserProfileService] Profile not completed or not found for user ${userId}`);
        return null;
      }

      // Build detailed profile information
      const details = [];
      
      // Always include user's name first if available
      if (userName) {
        details.push(`**User Full Name:** ${userName}`);
      }
      
      if (profile.primary_role) details.push(`**Role:** ${profile.primary_role}`);
      if (profile.experience) details.push(`**Experience:** ${profile.experience}`);
      if (profile.primary_jurisdiction) details.push(`**Jurisdiction:** ${profile.primary_jurisdiction}`);
      if (profile.main_areas_of_practice) details.push(`**Areas of Practice:** ${profile.main_areas_of_practice}`);
      if (profile.organization_name) details.push(`**Organization:** ${profile.organization_name}`);
      if (profile.organization_type) details.push(`**Organization Type:** ${profile.organization_type}`);
      if (profile.bar_enrollment_number) details.push(`**Bar Enrollment Number:** ${profile.bar_enrollment_number}`);
      if (profile.preferred_tone) details.push(`**Preferred Communication Tone:** ${profile.preferred_tone}`);
      if (profile.preferred_detail_level) details.push(`**Preferred Detail Level:** ${profile.preferred_detail_level}`);
      if (profile.citation_style) details.push(`**Citation Style:** ${profile.citation_style}`);
      if (profile.perspective) details.push(`**Professional Perspective:** ${profile.perspective}`);
      if (profile.typical_client) details.push(`**Typical Clients:** ${profile.typical_client}`);
      if (profile.highlights_in_summary) details.push(`**Summary Preferences:** ${profile.highlights_in_summary}`);

      if (details.length === 0) {
        console.log(`[UserProfileService] No profile details found for user ${userId}`);
        return null;
      }

      const contextString = `=== USER'S PROFESSIONAL PROFILE INFORMATION ===
The following information is the authenticated user's own professional profile data that they have stored in the system. This is NOT external data - it is their personal profile information that they have provided.

${details.join('\n')}

CRITICAL INSTRUCTIONS:
- When the user asks about their professional profile, credentials, or legal information, you MUST use the information provided above to answer their question.
- This is the user's OWN data that they have entered into the system - you have full permission to share it with them.
- Do NOT say you cannot access this information - you have it right here in the context above.
- Provide a clear, organized response listing their profile details from the information above.
- If they ask "give me my legal professional profile details", respond with their actual profile information from above.
${userName ? `- ALWAYS address the user by their name "${userName}" at the beginning of your responses. For example: "${userName}, your query answer is following..." or "${userName}, here is the information you requested..."` : ''}

---`;
      
      console.log(`[UserProfileService] Generated detailed profile context for user ${userId} (${details.length} fields)${userName ? ` (Name: ${userName})` : ''}`);
      return contextString;
    } catch (error) {
      console.error(`[UserProfileService] Failed to get detailed profile context:`, error.message);
      console.error(`[UserProfileService] Error stack:`, error.stack);
      return null;
    }
  }

  /**
   * Get full professional profile object
   * @param {number} userId - User ID
   * @param {string} authorizationHeader - Authorization header
   * @returns {Promise<Object|null>} - Profile object or null
   */
  static async getProfile(userId, authorizationHeader) {
    try {
      // Try multiple endpoints in order: direct auth service first (most reliable for local dev)
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
      const gatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:5000';
      
      // Try direct auth service first (more reliable, especially for local development)
      // Only use gateway if AUTH_SERVICE_URL is not set
      const endpoints = [];
      if (process.env.AUTH_SERVICE_URL || !process.env.API_GATEWAY_URL) {
        // Prefer direct auth service connection
        endpoints.push(`${authServiceUrl}/api/auth/professional-profile`);
      }
      if (process.env.API_GATEWAY_URL) {
        // Add gateway as fallback if explicitly configured
        endpoints.push(`${gatewayUrl}/auth/professional-profile`);
      }
      
      // If no endpoints configured, default to direct auth service
      if (endpoints.length === 0) {
        endpoints.push(`${authServiceUrl}/api/auth/professional-profile`);
      }
      
      console.log(`[UserProfileService] Will try ${endpoints.length} endpoint(s) for getProfile`);

      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          console.log(`[UserProfileService] Attempting to fetch full profile from: ${endpoint}`);
          const response = await axios.get(endpoint, {
            headers: {
              Authorization: authorizationHeader,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          });
          
          console.log(`[UserProfileService] ✅ Successfully fetched full profile from: ${endpoint}`);
          return response.data?.data || null;
        } catch (error) {
          console.warn(`[UserProfileService] Failed to fetch from ${endpoint}:`, error.response?.status || error.message);
          lastError = error;
          continue; // Try next endpoint
        }
      }
      
      // If all endpoints failed
      console.error(`[UserProfileService] ❌ All endpoints failed for getProfile. Last error:`, lastError?.response?.status || lastError?.message);
      return null;
    } catch (error) {
      console.error(`[UserProfileService] ❌ Unexpected error in getProfile for user ${userId}:`, error.message);
      return null;
    }
  }
}

module.exports = UserProfileService;

