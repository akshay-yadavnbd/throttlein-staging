/** The admin media library rows. */
const Media = require('./media.model');

const page = (filter, { skip, limit }) =>
  Promise.all([Media.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Media.countDocuments(filter)]);

const folders = (filter) => Media.distinct('folder', filter);
const findMany = (ids) => Media.find({ _id: { $in: ids } });
const deleteMany = (ids) => Media.deleteMany({ _id: { $in: ids } });
const findById = (id) => Media.findById(id);

module.exports = { page, folders, findMany, deleteMany, findById };
