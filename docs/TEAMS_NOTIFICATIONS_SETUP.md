# Optional Teams notification service

The existing `notifyTeam` helper continues sending internal email and also calls a small Teams adapter when a safe `notice` payload is supplied. Controllers provide a heading, display rows, and an admin path. All Teams routing, card formatting, and HTTP calls live in `backend/src/services/teamsNotifications.js`.

There are no Teams database models, migrations, admin settings screens, background workers, encryption keys, or changes to authentication. Existing email subscriptions stay as they are.

## Enable

1. Create a **Seller Registration** channel in your existing Throttlein team.
2. Create its **Send webhook alerts to a channel** Workflow and copy a fresh signed URL. Use a template that accepts a signed webhook request without an OAuth token. Give the Workflow a backup owner.
3. Paste the full Workflow URL directly into this optional backend setting:

   ```dotenv
   TEAMS_SELLER_WEBHOOK_URL="<paste the full Workflow URL here>"
   ```

4. Keep the existing `ADMIN_ORIGIN` pointing at the production HTTPS admin panel. Restart the backend with the updated environment.
5. Verify a synthetic seller registration in the intended channel and check its admin link before rollout. The exposed URL from the shared conversation should be replaced before use.

This one URL receives both seller registration and KYC notices. No JSON, event names, team ID, channel ID, or encryption key is needed in the environment. The Workflow already knows which team and channel to post to. The card includes only seller/store names and onboarding status. Full contact details, verification tokens, documents, tax IDs, and banking details remain out of the card. Re-registering an existing unverified seller retains the current email behavior without generating a new-seller Teams notice.

Orders and queries are not connected in this phase and need no settings yet. When adding them, extend the adapter's internal event-to-setting map with a clearly named URL setting and supply a safe `notice` at the corresponding `notifyTeam` call. Multiple subscribed event keys mapping to the same URL generate one card per helper call.

## Disable or remove

Leave `TEAMS_SELLER_WEBHOOK_URL` empty (or remove it) and restart the backend. Teams becomes a no-op and email continues. There is no database cleanup. To remove the integration from the code entirely, remove the adapter import/call from `notifyTeam` and delete the adapter file; the generic `notice` metadata can remain or be removed.

## Delivery behavior

Delivery is best-effort and runs independently of email, with a five-second HTTP timeout. Teams failures do not fail signup/KYC, and SMTP failures do not prevent the Teams attempt. There is no durable queue, automatic retry, or delivery history: a process restart or Microsoft outage can lose an alert. This matches the scope of an optional notification transport rather than a guaranteed event-processing system.

Signed webhook URLs remain in the backend environment, like other integration credentials. They are never included in API responses or logs. The adapter accepts only Microsoft Workflow invocation URLs, refuses redirects, and uses theme-aware Adaptive Cards. Verify actual channel delivery and light/dark rendering separately; HTTP success only indicates that Microsoft accepted the request.

## Checks

Run `npm run test:teams` from `backend`. Tests cover configuration, safe cards, routing, failures, and independence from email using a fake HTTP transport. No live webhook is called.
