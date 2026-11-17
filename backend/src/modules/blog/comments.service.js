/** Comment threads (approved only in public) and the moderation queue. */
const { AppError } = require('../../errors/AppError');
const posts = require('./posts.repository');
const comments = require('./comments.repository');
const { paging } = require('./public-blog.service');

async function publishedPost(site, slug) {
  const post = await posts.findPublishedBySlug(site, slug);
  if (!post) throw AppError.notFound('Post not found.');
  return post;
}

async function listPublic(site, slug) {
  const post = await publishedPost(site, slug);
  return { items: await comments.approvedForPost(post._id) };
}

/** Queued for moderation. Guests must give a name and email. */
async function submit(site, slug, { body, parent, guestName, guestEmail }, user) {
  const post = await publishedPost(site, slug);
  if (!body || body.trim().length < 2) throw AppError.badRequest('Comment body is required.');
  // `site` is denormalised from the post so the queue filters without a join.
  const doc = { site: post.site, post: post._id, body: body.trim(), parent: parent || null, status: 'pending' };
  if (user) {
    doc.user = user._id;
  } else {
    if (!guestName || !guestEmail) throw AppError.badRequest('Name and email are required for guest comments.');
    doc.guestName = guestName.trim();
    doc.guestEmail = guestEmail.trim();
  }
  const comment = await comments.create(doc);
  return { comment, queued: true };
}

async function adminList(site, query) {
  const { status = 'pending' } = query;
  const { limit, skip } = paging(query, 25);
  const filter = { site };
  if (comments.STATUSES.includes(status)) filter.status = status;
  const [items, total] = await comments.page(filter, { skip, limit });
  return { items, total, pages: Math.ceil(total / limit) };
}

async function loadComment(id, site) {
  const comment = await comments.findOne(id, site);
  if (!comment) throw AppError.notFound('Comment not found.');
  return comment;
}

/** Approve / spam / reject, keeping the post's commentCount in step. */
async function setStatus(site, id, status, reviewerId) {
  if (!comments.STATUSES.includes(status)) throw AppError.badRequest('Invalid status.');
  const comment = await loadComment(id, site);
  const prev = comment.status;
  comment.status = status;
  comment.reviewedBy = reviewerId;
  comment.reviewedAt = new Date();
  await comment.save();
  if (prev !== 'approved' && status === 'approved') await posts.bumpComments(comment.post, 1);
  else if (prev === 'approved' && status !== 'approved') await posts.bumpComments(comment.post, -1);
  return { comment };
}

async function remove(site, id) {
  const comment = await loadComment(id, site);
  if (comment.status === 'approved') await posts.bumpComments(comment.post, -1);
  await comment.deleteOne();
  return {};
}

module.exports = { listPublic, submit, adminList, setStatus, remove };
