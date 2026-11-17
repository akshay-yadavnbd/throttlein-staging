/** Saved delivery addresses; exactly one is the default whenever any exist. */
const { AppError } = require('../../errors/AppError');
const addresses = require('./addresses.repository');

const FIELDS = ['label', 'fullName', 'phone', 'line1', 'line2', 'city', 'state', 'pincode', 'country', 'isDefault'];

function pick(body) {
  const out = {};
  for (const k of FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

const makeDefault = (user, id) =>
  user.addresses.forEach((a) => {
    a.isDefault = String(a._id) === String(id);
  });

async function list(userId) {
  const user = await addresses.addressesOf(userId);
  return { addresses: user?.addresses || [] };
}

async function userAnd(userId, addressId) {
  const user = await addresses.loadUser(userId);
  const address = user?.addresses.id(addressId);
  if (!address) throw AppError.notFound('Address not found');
  return { user, address };
}

/** The first address is always the default; so is one sent with `isDefault`. */
async function create(userId, body) {
  const user = await addresses.loadUser(userId);
  if (!user) throw AppError.notFound('User not found');
  const fields = pick(body);
  fields.isDefault = !!(fields.isDefault || user.addresses.length === 0);
  if (fields.isDefault)
    user.addresses.forEach((a) => {
      a.isDefault = false;
    });
  user.addresses.push(fields);
  await user.save();
  return { addresses: user.addresses };
}

async function update(userId, addressId, body) {
  const { user, address } = await userAnd(userId, addressId);
  Object.assign(address, pick(body));
  if (body.isDefault === true) makeDefault(user, address._id);
  await user.save();
  return { addresses: user.addresses };
}

async function setDefault(userId, addressId) {
  const { user, address } = await userAnd(userId, addressId);
  makeDefault(user, address._id);
  await user.save();
  return { addresses: user.addresses };
}

/** Deleting the default promotes the first remaining address. */
async function remove(userId, addressId) {
  const { user, address } = await userAnd(userId, addressId);
  const wasDefault = address.isDefault;
  address.deleteOne();
  if (wasDefault && user.addresses.length > 0) user.addresses[0].isDefault = true;
  await user.save();
  return { addresses: user.addresses };
}

module.exports = { list, create, update, setDefault, remove };
