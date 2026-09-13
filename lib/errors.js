"use strict";
const { randomUUID } = require("node:crypto");
// Keep the legacy error string for web/older CLI consumers; add a stable machine contract.
module.exports = function errors(app) {
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.set("X-Request-Id", requestId);
    const json = res.json;
    res.json = function (body) {
      if (res.statusCode >= 400 && body && typeof body.error === "string") {
        const status = res.statusCode;
        const codes = {
          400: "VALIDATION_ERROR",
          401: "AUTH_REQUIRED",
          403: "ACCESS_DENIED",
          404: "NOT_FOUND",
          409: "REVISION_CONFLICT",
          413: "UPLOAD_TOO_LARGE",
          429: "RATE_LIMITED",
        };
        body = {
          ...body,
          code: body.code || codes[status] || "SERVER_ERROR",
          status,
          requestId,
          retryable: status === 429 || status >= 500,
          recovery:
            status === 401
              ? "Reconnect the existing profile using an authorized connection or recovery prompt."
              : status === 403
                ? "Use only actions allowed by this identity; do not switch accounts."
                : status === 409
                  ? "Read current state and resolve the conflict; do not blindly overwrite."
                  : status === 429
                    ? "Wait before retrying the same request."
                    : status >= 500
                      ? "Retry the same request ID and payload; preserve pending state."
                      : "Check the input and retry after correcting it.",
        };
        if (status === 429) res.set("Retry-After", "60");
      }
      return json.call(this, body);
    };
    next();
  });
};
