/** Every BlogComment query. Statements only. */
const BlogComment = require('./blog-comment.model');

const approvedForPost = (postId) =>
  BlogComment.find({ post: postId, status: 'approved' }).populate('user', 'name avatar').sort({ createdAt: 1 });
const create = (fields) => BlogComment.create(fields);
const page = (filter, { skip, limit }) =>
  Promise.all([
    BlogComment.find(filter)
      .populate('post', 'title slug')
      .populate('user', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    BlogComment.countDocuments(filter),
  ]);
const findOne = (id, site) => BlogComment.findOne({ _id: id, site });
const deleteForPost = (postId) => BlogComment.deleteMany({ post: postId });

module.exports = { STATUSES: BlogComment.STATUSES, approvedForPost, create, page, findOne, deleteForPost };
