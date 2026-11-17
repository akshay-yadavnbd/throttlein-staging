/**
 * What our middleware adds to Express's Request. Read by `npm run typecheck`
 * only; nothing here exists at runtime. `file` / `files` come from @types/multer.
 */
import 'express-serve-static-core';

type UserModel = typeof import('../models/User');

declare module 'express-serve-static-core' {
  interface Request {
    /** Request id (middleware/requestId.js); echoed as X-Request-Id. */
    id?: string;
    /** Signed-in account (middleware/auth.js `protect` / `optionalAuth`). */
    user?: InstanceType<UserModel>;
    /** Present when a superadmin is signed in as a seller (middleware/auth.js). */
    impersonation?: { adminId: string; adminEmail: string };
    /** Which front end sent the request (middleware/resolveSite.js). */
    site?: string;
    /** Raw JSON body, kept for webhook signature checks (app.js). */
    rawBody?: Buffer;
    /** Last checkout step reached; read by captureCheckoutFailure. */
    checkoutStep?: string;
    /** Storage folder for this request's uploads (middleware/upload/keys.js). */
    _uploadPrefix?: string;
  }
}
