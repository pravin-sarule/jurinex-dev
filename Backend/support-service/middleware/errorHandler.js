function errorHandler(err, req, res, next) {
  console.error("[SupportService] Unhandled error:", err);

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: "Each attachment must be 10MB or smaller.",
    });
  }

  if (err.code === "UNSUPPORTED_ATTACHMENT_TYPE") {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error.",
  });
}

module.exports = errorHandler;
