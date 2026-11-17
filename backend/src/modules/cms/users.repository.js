/** The one User read the CMS makes: resolving an optional bearer token. */
const User = require('../../models/User');

const findUserById = (id) => User.findById(id);

module.exports = { findUserById };
