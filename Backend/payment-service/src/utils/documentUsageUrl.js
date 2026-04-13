/**
 * Resolves the URL for GET user-usage-and-plan (contract: /api/files/user-usage-and-plan/:userId).
 *
 * - Set DOCUMENT_FILES_API_URL for server-to-server calls to agentic-document-service
 *   (e.g. http://localhost:8092/api/files) so local dev works even when the API gateway
 *   FILE_SERVICE_URL points at a remote host without this route.
 * - If unset, uses API_GATEWAY_URL + /files/... (gateway must proxy to a service that implements the route).
 */
function getUserUsageAndPlanUrl(userId) {
  const direct = (process.env.DOCUMENT_FILES_API_URL || "").trim().replace(/\/$/, "");
  if (direct) {
    return `${direct}/user-usage-and-plan/${userId}`;
  }
  const gateway = (process.env.API_GATEWAY_URL || "http://localhost:5000").trim().replace(/\/$/, "");
  return `${gateway}/files/user-usage-and-plan/${userId}`;
}

function usageRequestHeaders(authorizationHeader, userId) {
  const headers = {};
  if (authorizationHeader) {
    headers.Authorization = authorizationHeader;
  }
  if (userId != null && userId !== "") {
    headers["x-user-id"] = String(userId);
  }
  return headers;
}

module.exports = { getUserUsageAndPlanUrl, usageRequestHeaders };
