import type { Kyc } from './kyc';

const text = (value?: string) => (value || '').trim();
/** Compare editable details only; formatting-only edits are not new submissions. */
export function kycChangeSections(current: Partial<Kyc>, baseline: Partial<Kyc>): string[] {
  const groups = (value: Partial<Kyc>) => [
    [text(value.gstin).toUpperCase(), text(value.pan).toUpperCase(), text(value.gstCertificate), text(value.panCard)],
    ['line1', 'line2', 'city', 'state', 'pincode', 'country'].map(key => text(value.pickupAddress?.[key as keyof NonNullable<Kyc['pickupAddress']>])),
    [text(value.bankDetails?.accountHolder), text(value.bankDetails?.bankName), text(value.bankDetails?.accountNumber).replace(/\s+/g, ''), text(value.bankDetails?.ifsc).toUpperCase(), text(value.bankDetails?.cancelledCheque)],
  ];
  const before = groups(baseline);
  return groups(current).flatMap((group, index) => JSON.stringify(group) === JSON.stringify(before[index]) ? [] : [['Tax IDs', 'Pickup address', 'Bank details'][index]]);
}
