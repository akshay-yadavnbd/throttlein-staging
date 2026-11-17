/**
 * Project-wide conventions the type checker should know about. Read by
 * `npm run typecheck` only; nothing here exists at runtime.
 */
export {};

declare global {
  /**
   * Thrown errors may carry an HTTP `status` and a machine `code`
   * (middleware/errorHandler.js and utils/logger.js read both), and a
   * carrier error keeps the provider's response body on `data`.
   */
  interface Error {
    status?: number;
    code?: string | number;
    data?: any;
  }

  /**
   * A postal address as stored on orders (shippingAddress), customers
   * (addresses[]) and seller KYC (pickupAddress). Every field is optional:
   * readers fall back to `{}` and treat each field as possibly missing.
   */
  interface PostalAddress {
    label?: string;
    fullName?: string;
    phone?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  }
}
