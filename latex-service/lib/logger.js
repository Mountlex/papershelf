const pino = require("pino");

// Create the logger instance
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Use pino-pretty in development for readable output
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  // Base fields included in every log
  base: {
    service: "latex-service",
  },
});

/**
 * Create a child logger with additional context.
 *
 * @param {Object} bindings - Additional context fields
 * @returns {Object} - Child logger instance
 */
function createChildLogger(bindings) {
  return logger.child(bindings);
}

/**
 * Create a request-scoped logger with request ID.
 *
 * @param {string} requestId - The request ID
 * @param {string} [endpoint] - The endpoint being called
 * @returns {Object} - Request-scoped logger
 */
function createRequestLogger(requestId, endpoint) {
  return logger.child({
    requestId,
    endpoint,
  });
}

module.exports = {
  logger,
  createChildLogger,
  createRequestLogger,
};
