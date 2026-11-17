/**
 * Blog module — public surface. Posts, categories, tags, the shared
 * author roster and comment moderation, per site.
 *
 *   routes      blog.routes.js             public (/api/blog) and admin (/api/admin/blog) routers
 *   controller  blog.controller.js         HTTP ⇄ service, no rules
 *   services    public-blog, posts, taxonomy, comments
 *   pure        category-chain (root → leaf chain, slugify)
 *   data        posts / taxonomy / comments repositories
 */
const controller = require('./blog.controller');

module.exports = {
  ...controller,
  routes: require('./blog.routes'),
};
