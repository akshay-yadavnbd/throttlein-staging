/**
 * Chrome DevTools asks every origin for this file (its "automatic
 * workspace folders" feature). Without a handler each dev page load logged
 * a 404 in the Next console. Empty 204 = "nothing to configure".
 */
export function GET() {
  return new Response(null, { status: 204 });
}
