/**
 * Admin-triggered onboarding reminders. Sellers routinely register and then
 * stop — they never click the verification link, verify but never upload
 * documents, or don't resubmit after a KYC rejection. The admin's per-seller
 * "Send reminder" emails the nudge for wherever that seller stalled. What
 * counts as stalled, and the cooldown, live in utils/sellerOnboarding.js
 * ('pending' KYC is deliberately not stalled: it is waiting on us).
 */
const mailer = require('../../config/mail');
const { AppError } = require('../../errors/AppError');
const { STAGES, STAGE_LABELS, onboardingStage, reminderCooldown, humanizeMs } = require('../../utils/sellerOnboarding');
const { buildVerifyUrl } = require('../auth');
const users = require('./users.repository');
const emails = require('./onboarding-reminder-emails');

/**
 * The email for a stalled seller, or null for an unknown stage (the caller
 * fails loudly rather than sending a blank). The unverified branch MUTATES
 * `user` with a fresh verify token — the original long expired, and a dead
 * link is worse than none — so the caller must save.
 */
function buildReminder(user, stage) {
  if (stage === STAGES.UNVERIFIED) {
    const link = buildVerifyUrl(user.generateEmailVerifyToken());
    return {
      subject: 'Confirm your email to activate your THROTTLEIN seller account',
      html: emails.remindUnverifiedHtml({ name: user.name, link }),
      text:
        `Hi ${user.name || 'there'}, you started creating a THROTTLEIN seller account ` +
        `but never confirmed your email. Confirm and set a password: ${link}`,
    };
  }
  if (stage === STAGES.NO_KYC) {
    const link = emails.frontendUrl('/dashboard/kyc');
    return {
      subject: 'Finish your THROTTLEIN seller setup',
      html: emails.remindNoKycHtml({ name: user.name, storeName: user.storeName, link }),
      text:
        `Hi ${user.name || 'there'}, your THROTTLEIN seller account is ready but we ` +
        `haven't received your KYC documents. Complete it here: ${link}`,
    };
  }
  if (stage === STAGES.KYC_REJECTED) {
    const link = emails.frontendUrl('/dashboard/kyc');
    const reason = user.kyc?.rejectionReason || '';
    return {
      subject: 'Your THROTTLEIN KYC needs another look',
      html: emails.remindKycRejectedHtml({ name: user.name, reason, link }),
      text:
        `Hi ${user.name || 'there'}, we couldn't approve your KYC documents.` +
        (reason ? ` Reason: ${reason}.` : '') +
        ` Resubmit here: ${link}`,
    };
  }
  return null;
}

/**
 * Send the nudge. Refuses (rather than no-ops) for a seller who is not
 * stalled; respects the cooldown unless the admin forces it (a double-click
 * or two staff on the same list must not double-mail). The send is awaited
 * — the admin is waiting to hear whether it went — and the reminder is
 * recorded only after it did, so a failure starts no cooldown.
 */
async function sendReminder(idOrSlug, { force = false } = {}) {
  const user = await users.findSellerByIdOrSlug(idOrSlug);
  if (!user) throw AppError.notFound('Seller not found.');
  const stage = onboardingStage(user);
  if (!stage) {
    throw AppError.conflict(
      user.kyc?.status === 'pending'
        ? 'This seller has already submitted KYC and is awaiting your review.'
        : 'This seller has finished onboarding — nothing to remind them about.',
    );
  }
  const cooldown = reminderCooldown(user);
  if (!cooldown.allowed && !force) {
    throw AppError.rateLimited(`Reminder already sent · try again in ${humanizeMs(cooldown.msRemaining)}`);
  }
  const mail = buildReminder(user, stage);
  if (!mail) throw AppError.internal(`No reminder template for onboarding stage "${stage}".`);
  try {
    await mailer.sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
  } catch (e) {
    throw AppError.upstream(`Couldn't send the email: ${e.message}`);
  }
  user.onboardingReminder = {
    lastSentAt: new Date(),
    count: (user.onboardingReminder?.count || 0) + 1,
    lastStage: stage,
  };
  // Mid-onboarding accounts are legitimately incomplete (an unverified seller has no password yet).
  await user.save({ validateBeforeSave: false });
  return {
    stage,
    stageLabel: STAGE_LABELS[stage] || stage,
    sentTo: user.email,
    onboardingReminder: user.onboardingReminder,
    message: `Reminder sent to ${user.email}.`,
  };
}

module.exports = { sendReminder, buildReminder };
