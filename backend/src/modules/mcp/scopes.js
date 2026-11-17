/**
 * OAuth scopes for the MCP connection, derived from admin-panel permissions.
 *
 * A connection acts as the signed-in staff member and can only reach what
 * they could reach in the admin panel: each `<area>:read` scope maps to the
 * permission key the admin router gates that area on. Superadmins hold every
 * scope. `profile:read` is implicit for any staff/superadmin and covers the
 * tools that reveal nothing beyond aggregate counts and the user's own
 * identity. `contact:read` additionally lets a connection *ask* for unmasked
 * customer/seller contact details (the superadmin switch must also be on and
 * every reveal is audited). `ops:admin` is superadmin-only: the connector's
 * own audit trail. Write scopes do not exist yet; a write tool must introduce
 * `<area>:write` and record its calls.
 */
'use strict';

const SUPERADMIN_ONLY = Symbol('superadmin-only');

const SCOPE_PERMISSIONS = Object.freeze({
  'profile:read': null,
  'orders:read': 'orders',
  'refunds:read': 'refunds',
  'sellers:read': 'sellers',
  'kyc:read': 'kyc',
  'settlements:read': 'settlements',
  'contact:read': 'customers',
  'ops:admin': SUPERADMIN_ONLY,
});

const SCOPE_LABELS = Object.freeze({
  'profile:read': 'Your identity and the marketplace overview',
  'orders:read': 'Orders, shipments and checkout failures',
  'refunds:read': 'Refund requests',
  'sellers:read': 'Sellers and products',
  'kyc:read': 'Pending KYC submissions',
  'settlements:read': 'Seller settlements',
  'contact:read': 'Unmasked customer and seller contact details (on request, audited)',
  'ops:admin': "The connector's own audit trail (superadmin)",
});

const ALL_SCOPES = Object.freeze(Object.keys(SCOPE_PERMISSIONS));

function isStaff(user) {
  return Boolean(user) && (user.role === 'superadmin' || user.role === 'staff') && user.status !== 'suspended';
}

/** Scopes this user may hold right now, from their live role and permissions. */
function allowedScopes(user) {
  if (!isStaff(user)) return [];
  if (user.role === 'superadmin') return [...ALL_SCOPES];
  const permissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
  return ALL_SCOPES.filter((scope) => {
    const needs = SCOPE_PERMISSIONS[scope];
    return needs === null || (needs !== SUPERADMIN_ONLY && permissions.has(needs));
  });
}

/** Requested ∩ allowed; an empty request means "everything I'm allowed". Unknown scopes are dropped. */
function grantScopes(requested, user) {
  const allowed = allowedScopes(user);
  if (!requested || !requested.length) return allowed;
  return allowed.filter((scope) => requested.includes(scope));
}

/** Who may read each area — for `tin_access_explain`. */
function describeAreas() {
  return Object.fromEntries(
    ALL_SCOPES.map((scope) => {
      const needs = SCOPE_PERMISSIONS[scope];
      return [
        scope,
        needs === null
          ? 'any staff member'
          : needs === SUPERADMIN_ONLY
            ? 'superadmin only'
            : `staff with the "${needs}" admin permission (superadmins always)`,
      ];
    }),
  );
}

module.exports = { SCOPE_PERMISSIONS, SCOPE_LABELS, ALL_SCOPES, isStaff, allowedScopes, grantScopes, describeAreas };
