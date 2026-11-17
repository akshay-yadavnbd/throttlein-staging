/**
 * Seller requests for a new brand or category, and the admin review queue.
 * Approval only stamps the request: the admin creates the Brand / Category
 * through /api/brands or /api/categories first and passes its id here.
 */
const { AppError } = require('../../errors/AppError');
const requests = require('./brand-requests.repository');

const TYPES = ['brand', 'category'];
const STATUSES = ['pending', 'approved', 'rejected'];

/** Only KYC-approved sellers may ask (the dashboard hides the form too). Superadmins always pass. */
function assertKycApproved(user) {
  if (user?.role === 'superadmin') return;
  const status = user?.kyc?.status || 'not_started';
  if (status === 'approved') return;
  throw AppError.forbidden(
    status === 'pending'
      ? "Your KYC is still under review. You can request new brands or categories once it's approved."
      : status === 'rejected'
        ? 'Your KYC was rejected. Please update your documents and get re-verified before requesting catalog changes.'
        : 'Please complete and submit your KYC before requesting brands or categories.',
  );
}

const checkType = (type) => {
  if (!TYPES.includes(type)) throw AppError.badRequest('type must be "brand" or "category".');
  return type;
};
const checkName = (name) => {
  if (!name || name.trim().length < 2) throw AppError.badRequest('name must be at least 2 characters.');
  return name.trim();
};
const cleanNotes = (notes) => (typeof notes === 'string' ? notes.trim() : '');

async function loadRequest(id) {
  const request = await requests.findById(id);
  if (!request) throw AppError.notFound('Request not found.');
  return request;
}

/** The caller's own request, still pending: decided rows stay frozen as the audit trail. */
async function loadOwnPending(user, id, verb) {
  const request = await loadRequest(id);
  if (String(request.seller) !== String(user._id)) throw AppError.forbidden(`You can only ${verb} your own requests.`);
  if (request.status !== 'pending') throw AppError.badRequest(`Cannot ${verb} a ${request.status} request.`);
  return request;
}

/* ── seller ───────────────────────────────────────────────────────────── */

async function submit(user, body) {
  assertKycApproved(user);
  const request = await requests.create({
    seller: user._id,
    type: checkType(body.type),
    name: checkName(body.name),
    parentCategory: body.parentCategory || null,
    notes: cleanNotes(body.notes),
  });
  return { request };
}

async function listOwn(user) {
  return { items: await requests.listForSeller(user._id) };
}

async function editOwn(user, id, body) {
  assertKycApproved(user);
  const request = await loadOwnPending(user, id, 'edit');
  if (body.type !== undefined) request.type = checkType(body.type);
  if (body.name !== undefined) request.name = checkName(body.name);
  if (body.parentCategory !== undefined) request.parentCategory = body.parentCategory || null;
  if (body.notes !== undefined) request.notes = cleanNotes(body.notes);
  await request.save();
  await request.populate('parentCategory', requests.PARENT_FIELDS);
  return { request };
}

async function withdrawOwn(user, id) {
  const request = await loadOwnPending(user, id, 'delete');
  await request.deleteOne();
}

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminList(query) {
  const status = String(query.status || 'pending');
  const filter = {};
  if (status !== 'all') {
    if (!STATUSES.includes(status)) throw AppError.badRequest('Invalid status filter.');
    filter.status = status;
  }
  return { items: await requests.listForAdmin(filter) };
}

async function adminGet(id) {
  const request = await requests.findForAdmin(id);
  if (!request) throw AppError.notFound('Request not found.');
  return { request };
}

async function loadPending(id) {
  const request = await loadRequest(id);
  if (request.status !== 'pending') throw AppError.badRequest(`Request is already ${request.status}.`);
  return request;
}

function decide(request, admin, status, note) {
  request.status = status;
  request.decidedBy = admin._id;
  request.decidedAt = new Date();
  request.decisionNote = note;
}

async function approve(admin, id, { createdResourceId, decisionNote }) {
  if (!createdResourceId) throw AppError.badRequest('createdResourceId is required to approve a request.');
  const request = await loadPending(id);
  decide(request, admin, 'approved', cleanNotes(decisionNote));
  request.createdResourceId = createdResourceId;
  await request.save();
  return { request };
}

async function reject(admin, id, { decisionNote }) {
  if (!decisionNote || decisionNote.trim().length < 5) {
    throw AppError.badRequest('A reason of at least 5 characters is required to reject.');
  }
  const request = await loadPending(id);
  decide(request, admin, 'rejected', decisionNote.trim());
  await request.save();
  return { request };
}

/** Clears a row from the queue; a pending one is allowed (the admin confirms in the UI). */
async function adminDelete(id) {
  const request = await loadRequest(id);
  await request.deleteOne();
}

module.exports = { submit, listOwn, editOwn, withdrawOwn, adminList, adminGet, approve, reject, adminDelete };
