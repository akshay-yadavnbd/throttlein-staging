/** Shiprocket pickup locations: list, register, edit, remove (one per seller pickup address). */
const { MOCK, mockLog, mockState, mockAddPickup, srRequest } = require('./client');

/** GET /external/settings/company/pickup — list all pickup locations on the account */
function listPickupLocations() {
  if (MOCK) {
    mockLog(`listPickupLocations() — ${mockState.pickups.size} entries`);
    return Promise.resolve({
      data: { shipping_address: Array.from(mockState.pickups.values()) },
    });
  }
  return srRequest('GET', '/settings/company/pickup');
}

/**
 * POST /external/settings/company/addpickup
 *
 * Register a seller's pickup address with Shiprocket so we can ship from it.
 * `pickup_location` is a NICKNAME that must be unique on the account. We use
 * `{sellerSlug}-{pincode}` so collisions can't happen and the admin can
 * read it.
 */
function addPickupLocation({
  pickup_location,
  name,
  email,
  phone,
  address,
  address_2 = '',
  city,
  state,
  country = 'India',
  pin_code,
}) {
  if (MOCK) {
    mockLog(`addPickupLocation(${pickup_location})`);
    const entry = mockAddPickup({
      pickup_location,
      name,
      email,
      phone,
      address,
      address_2,
      city,
      state,
      country,
      pin_code,
    });
    return Promise.resolve({
      success: true,
      address: entry,
      message: 'MOCK: pickup created (no real API call made)',
    });
  }
  return srRequest('POST', '/settings/company/addpickup', {
    pickup_location,
    name,
    email,
    phone,
    address,
    address_2,
    city,
    state,
    country,
    pin_code,
  });
}

/**
 * Best-effort removal of a pickup location.
 *
 * Shiprocket's API surface here is inconsistent across accounts; some accept
 * DELETE /settings/company/pickup/{id}, others want POST /removepickup with
 * { id }. We try both. If neither works (older accounts), we throw a soft
 * error the caller can log without crashing.
 */
async function removePickupLocation({ pickup_id }) {
  if (MOCK) {
    mockLog(`removePickupLocation(${pickup_id})`);
    for (const [k, v] of mockState.pickups) {
      if (v.id === pickup_id) mockState.pickups.delete(k);
    }
    return { success: true, message: 'MOCK: pickup removed.' };
  }
  try {
    return await srRequest('DELETE', `/settings/company/pickup/${pickup_id}`);
  } catch (e1) {
    try {
      return await srRequest('POST', '/settings/company/removepickup', { id: pickup_id });
    } catch (e2) {
      const err = new Error(`Couldn't remove pickup on Shiprocket: ${e1.message || ''} / ${e2.message || ''}`);
      err.code = 'PICKUP_DELETE_UNSUPPORTED';
      throw err;
    }
  }
}

/**
 * POST /v1/external/settings/company/update/pickup
 *
 * Edit an existing pickup address (same nickname). Used when the seller
 * updates their pickup address post-KYC — without this call our DB has the
 * new address but Shiprocket still ships from the old one.
 */
function updatePickupLocation({
  pickup_location,
  name,
  email,
  phone,
  address,
  address_2 = '',
  city,
  state,
  country = 'India',
  pin_code,
}) {
  if (MOCK) {
    mockLog(`updatePickupLocation(${pickup_location})`);
    // Overwrite the entry in the mock store, keeping the existing id.
    const key = String(pickup_location).toLowerCase();
    const existing = mockState.pickups.get(key);
    const entry = {
      id: existing?.id || mockState.nextPickupId++,
      pickup_location,
      name,
      email,
      phone,
      address,
      address_2,
      city,
      state,
      country,
      pin_code,
      phone_verified: existing?.phone_verified ?? (mockState.defaultVerified ? 1 : 0),
      status: 1,
    };
    mockState.pickups.set(key, entry);
    return Promise.resolve({ success: true, address: entry, message: 'MOCK: pickup updated.' });
  }
  return srRequest('POST', '/settings/company/update/pickup', {
    pickup_location,
    name,
    email,
    phone,
    address,
    address_2,
    city,
    state,
    country,
    pin_code,
  });
}

module.exports = { listPickupLocations, addPickupLocation, updatePickupLocation, removePickupLocation };
