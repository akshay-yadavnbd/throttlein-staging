/** Seller guide cards (seller landing page) and their heading singleton. */
const { AppError } = require('../../errors/AppError');
const content = require('./content.repository');

const WRITABLE = [
  'title',
  'slug',
  'shortDescription',
  'content',
  'image',
  'order',
  'isActive',
  'publishedAt',
  'metaTitle',
  'metaDescription',
  'ogImage',
];
const pick = (body) => Object.fromEntries(WRITABLE.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

async function list(query) {
  const items = await content.guides(query.active === '1' ? { isActive: true } : {});
  return { items, count: items.length };
}

async function bySlug(rawSlug) {
  const guide = await content.guideBySlug(
    String(rawSlug || '')
      .trim()
      .toLowerCase(),
  );
  if (!guide) throw AppError.notFound('Guide not found');
  return { guide };
}

async function loadGuide(id) {
  const guide = await content.guideById(id);
  if (!guide) throw AppError.notFound('Guide not found');
  return guide;
}
const byId = async (id) => ({ guide: await loadGuide(id) });

/** The slug derives from the title when blank; a friendly 409 replaces the raw dup-key error. */
async function create(body) {
  const fields = pick(body);
  if (!fields.title || !String(fields.title).trim()) throw AppError.badRequest('Guide title is required');
  fields.slug = slugify(fields.slug && String(fields.slug).trim() ? fields.slug : fields.title);
  if (!fields.slug) throw AppError.badRequest('Could not derive a valid slug from the title');
  if (await content.guideSlugTaken(fields.slug))
    throw AppError.conflict(`A guide with slug "${fields.slug}" already exists`);
  if (typeof fields.order !== 'number') fields.order = 0;
  if (fields.isActive === undefined) fields.isActive = true;
  return { guide: await content.createGuide(fields) };
}

async function update(id, body) {
  const guide = await loadGuide(id);
  const fields = pick(body);
  if (fields.slug !== undefined) {
    fields.slug = slugify(fields.slug);
    if (!fields.slug) throw AppError.badRequest('Slug cannot be empty');
    if (await content.guideSlugTaken(fields.slug, guide._id))
      throw AppError.conflict(`A guide with slug "${fields.slug}" already exists`);
  }
  Object.assign(guide, fields);
  await guide.save();
  return { guide };
}

async function remove(id) {
  const guide = await loadGuide(id);
  await guide.deleteOne();
  return { message: 'Guide deleted' };
}

async function getSection(query) {
  const section = await content.guideSection();
  return { section: query.active === '1' && !section.isActive ? null : section };
}

async function updateSection(body) {
  const section = await content.guideSection();
  if (typeof body.heading === 'string') section.heading = body.heading;
  if (typeof body.subheading === 'string') section.subheading = body.subheading;
  if (body.isActive !== undefined) section.isActive = Boolean(body.isActive);
  await section.save();
  return { section };
}

module.exports = { list, bySlug, byId, create, update, remove, getSection, updateSection };
