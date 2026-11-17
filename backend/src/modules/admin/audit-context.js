/** Who did it, from where — the fields every audit row carries. Pure. */
function auditContext(req) {
  return {
    actor: req.user._id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    ip: req.ip,
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300),
  };
}

module.exports = { auditContext };
