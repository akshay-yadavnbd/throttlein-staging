/**
 * AssistantConversation — one Throttlein Assistant chat, owned by the seller
 * (or superadmin) who had it. Written by the assistant service after each
 * reply (with the user's own JWT) and read back by the widget's History view.
 *
 * Bounded on purpose: a conversation keeps its newest MAX_MESSAGES messages,
 * a user keeps their newest MAX_PER_USER conversations (older ones are pruned
 * on create). `table` is the small descriptor the widget uses to re-fetch a
 * paginated list ({ tool, args, total }), never the rows themselves.
 */
const mongoose = require('mongoose');

const MAX_MESSAGES = 200;
const MAX_PER_USER = 100;

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 20000 },
    table: { type: mongoose.Schema.Types.Mixed, default: undefined },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const assistantConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: 'New chat' },
    messages: { type: [messageSchema], default: [] },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true, statics: { MAX_MESSAGES, MAX_PER_USER } },
);

assistantConversationSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('AssistantConversation', assistantConversationSchema);
