/** Saved assistant chats. Every query carries the owner, so one user can never reach another's chats. */
const AssistantConversation = require('./conversation.model');

const SUMMARY = { title: 1, messageCount: 1, createdAt: 1, updatedAt: 1 };

/** History caps, from the model. */
const { MAX_MESSAGES, MAX_PER_USER } = AssistantConversation;

const listForUser = (userId, limit) =>
  AssistantConversation.find({ user: userId })
    .select('title messageCount createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
const create = (fields) => AssistantConversation.create(fields);
const findOwn = (id, userId) => AssistantConversation.findOne({ _id: id, user: userId }).lean();

/** Drop the user's oldest chats beyond the cap. */
async function trimToCap(userId) {
  const stale = await AssistantConversation.find({ user: userId })
    .sort({ updatedAt: -1 })
    .skip(MAX_PER_USER)
    .select('_id')
    .lean();
  if (stale.length) await AssistantConversation.deleteMany({ _id: { $in: stale.map((s) => s._id) }, user: userId });
}

/** Append, keeping only the newest MAX_MESSAGES. */
const append = (id, userId, messages) =>
  AssistantConversation.findOneAndUpdate(
    { _id: id, user: userId },
    { $push: { messages: { $each: messages, $slice: -MAX_MESSAGES } }, $inc: { messageCount: messages.length } },
    { returnDocument: 'after', projection: SUMMARY },
  );

const rename = (id, userId, title) =>
  AssistantConversation.findOneAndUpdate(
    { _id: id, user: userId },
    { title },
    { returnDocument: 'after', projection: SUMMARY },
  );

const deleteOwn = (id, userId) => AssistantConversation.deleteOne({ _id: id, user: userId });

module.exports = { listForUser, create, findOwn, trimToCap, append, rename, deleteOwn };
