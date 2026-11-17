/** A refusal from the MCP admin screens: HTTP status + stable code; routes/adminMcpRoutes.js maps it to an AppError. */
class ManageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { ManageError };
