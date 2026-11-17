/**
 * CMS pages per site: public reads (Redis-cached, 5 minutes — long enough
 * to smooth hot paths, short enough that a missed bust self-heals) and
 * the admin writes, each of which busts every `page:*` key and asks the
 * storefront to revalidate the page's route.
 */
const jwt = require('jsonwebtoken');
const { revalidatePath } = require('../../infrastructure/storefront/revalidate');
const escapeRegExp = require('../../utils/escapeRegExp');
const { getOrSetCache, deleteCacheByPattern } = require('../../utils/redisCache');
const { permissionKeyFor } = require('../../config/sites');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const pages = require('./pages.repository');
const users = require('./users.repository');
const { VALID_TYPES, pageToRoute, pickDynamicFields } = require('./page-input');

const CACHE_TTL = 300;
const bustCaches = () => deleteCacheByPattern('page:*');
const TEXT_FIELDS = [
  'slug',
  'title',
  'body',
  'seoTitle',
  'seoDescription',
  'ogImage',
  'contentTitle',
  'contentDescription',
  'bottomTitle',
  'bottomDescription',
];

/** Best-effort user from a bearer token on a route that is public by default. */
async function optionalUser(auth) {
  if (auth.user) return auth.user;
  const header = auth.authorization || '';
  const token = header.startsWith('Bearer ') ? header.split(' ')[1] : null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await users.findUserById(decoded.id);
    return !user || user.status === 'suspended' ? null : user;
  } catch {
    return null;
  }
}

/**
 * Public list (published only). `?all=1` exposes drafts, so it needs an
 * authenticated caller holding the site's pages permission — checked here
 * because the route itself carries no guard.
 */
async function list(site, query, auth) {
  const { q, all, type, template } = query;
  const filter = { site };
  if (q) filter.title = new RegExp(escapeRegExp(q), 'i');
  if (type) filter.type = type;
  if (template) filter.template = template;
  if (all === '1') {
    const user = await optionalUser(auth);
    if (!user) throw AppError.unauthorized('Authentication required to list unpublished pages.');
    const key = permissionKeyFor('pages', site);
    const allowed = user.role === 'superadmin' || (user.role === 'staff' && (user.permissions || []).includes(key));
    if (!allowed) throw AppError.forbidden(`Access denied. Missing permission: ${key}.`);
  } else {
    filter.isPublished = true;
  }
  const items = await pages.list(filter);
  return { items, count: items.length };
}

/** SEO override for a static storefront route; `/` also reads the home record. */
async function staticMeta(site, route) {
  if (!route || !route.startsWith('/')) return { override: null };
  const filter =
    route === '/'
      ? {
          site,
          $or: [
            { type: 'static-meta', staticRoute: '/', isPublished: true },
            { type: 'home', isPublished: true },
          ],
        }
      : { site, type: 'static-meta', staticRoute: route, isPublished: true };
  const override = await getOrSetCache(`page:${site}:static-meta:${route}`, CACHE_TTL, () => pages.findOne(filter));
  return { override: override || null };
}

async function bySlug(site, rawSlug) {
  const slug = rawSlug.toLowerCase();
  const page = await getOrSetCache(`page:${site}:slug:${slug}`, CACHE_TTL, async () => {
    const doc = await pages.findOnePopulated({ site, slug });
    // `null` (not undefined) so the "not found" sentinel is cached too.
    return !doc || !doc.isPublished ? null : doc;
  });
  if (!page) throw AppError.notFound('Page not found');
  return { page };
}

/**
 * /<cat>/<page> or /<cat>/<brand>/<page> → the Page. The 2-segment form
 * must NOT target a brand and the 3-segment form must, so the shapes
 * never shadow each other.
 */
async function resolveRoute(site, query) {
  const slug = String(query.slug || '')
    .toLowerCase()
    .trim();
  const parentSlug = query.parent ? String(query.parent).toLowerCase().trim() : '';
  const brandSlug = query.brand ? String(query.brand).toLowerCase().trim() : '';
  if (!slug) throw AppError.badRequest('slug query is required');
  let parentId = null;
  if (parentSlug) {
    const parent = await pages.categoryBySlug(parentSlug);
    if (!parent) throw AppError.notFound('Parent category not found');
    parentId = parent._id;
  }
  const find = { site, slug, parentCategory: parentId, isPublished: true };
  if (brandSlug) {
    const brand = await pages.brandBySlug(brandSlug);
    if (!brand) throw AppError.notFound('Brand not found');
    find['filter.brand'] = brand._id;
  } else {
    find.$or = [{ 'filter.brand': null }, { 'filter.brand': { $exists: false } }];
  }
  const key = `page:${site}:route:${parentSlug || '-'}:${brandSlug || '-'}:${slug}`;
  const page = await getOrSetCache(key, CACHE_TTL, () => pages.findOnePopulated(find));
  if (!page) throw AppError.notFound('Page not found');
  return { page };
}

async function loadOnSite(id, site) {
  const page = await pages.findOne({ _id: id, site });
  if (!page) throw AppError.notFound('Page not found');
  return page;
}

/** Admin fetch by id — bypasses the publish gate, still site-scoped. */
const byId = async (site, id) => ({ page: await loadOnSite(id, site) });

async function afterWrite(page) {
  const route = pageToRoute(page);
  if (route) revalidatePath(route);
  await bustCaches();
}

async function create(site, body) {
  const { title, type, isPublished, order } = body;
  if (!title || !title.trim()) throw AppError.badRequest('Title is required');
  const text = Object.fromEntries(TEXT_FIELDS.map((k) => [k, body[k] || '']));
  const page = await pages.create({
    site, // from the request context, never the body
    ...text,
    slug: body.slug && body.slug.trim() ? body.slug.trim() : undefined,
    title: title.trim(),
    type: VALID_TYPES.has(type) ? type : 'prose',
    isPublished: isPublished !== false,
    order: typeof order === 'number' ? order : 0,
    ...pickDynamicFields(body),
  });
  await afterWrite(page);
  return { page };
}

/** `site` is deliberately not assignable: a page cannot be moved between properties. */
async function update(site, id, body) {
  const page = await loadOnSite(id, site);
  for (const k of TEXT_FIELDS) if (body[k] !== undefined) page[k] = body[k];
  if (body.type !== undefined && VALID_TYPES.has(body.type)) page.type = body.type;
  if (body.isPublished !== undefined) page.isPublished = !!body.isPublished;
  if (body.order !== undefined) page.order = body.order;
  Object.assign(page, pickDynamicFields(body, page));
  await page.save();
  await afterWrite(page);
  return { page };
}

/** The home record is system-managed and cannot be deleted. */
async function remove(site, id) {
  const page = await loadOnSite(id, site);
  if (page.type === 'home') throw AppError.badRequest('The home page record is system-managed and cannot be deleted.');
  await page.deleteOne();
  await afterWrite(page);
  return {};
}

module.exports = { list, staticMeta, bySlug, resolveRoute, byId, create, update, remove, CACHE_TTL };
