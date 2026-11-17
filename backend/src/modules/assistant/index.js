/**
 * Assistant module — public surface. The Throttlein Assistant's saved chat
 * history (the assistant itself runs as the separate chatbot/ service).
 *
 *   routes      conversations.routes.js      /api/assistant/conversations
 *   controller  conversations.controller.js  HTTP ⇄ service, no rules
 *   service     conversations.service.js     message cleaning, titles, ownership
 *   data        conversations.repository.js
 *   model       conversation.model.js
 */
module.exports = {
  routes: require('./conversations.routes'),
};
