/** Saved delivery addresses — an array on the user document. */
const User = require('../../models/User');

const addressesOf = (userId) => User.findById(userId).select('addresses');
const loadUser = (userId) => User.findById(userId);

module.exports = { addressesOf, loadUser };
