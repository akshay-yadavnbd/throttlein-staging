import type { SellerUser } from './auth';

export function sellerProfileForm(user: SellerUser | null) {
  return {
    name: user?.name || '',
    storeName: user?.storeName || '',
    phone: user?.phone || '',
    alternatePhone: user?.alternatePhone || '',
    returnPolicyDays: user?.returnPolicyDays ?? 7,
    exchangePolicyDays: user?.exchangePolicyDays ?? 7,
    codEnabled: user?.codEnabled !== false,
    codCharge: user?.codCharge ?? 0,
    deliveryPaidByCustomer: user?.deliveryPaidByCustomer === true,
    excludedStates: user?.excludedStates || [],
    excludedPincodes: (user?.excludedPincodes || []).join(', '),
  };
}

export function parseExcludedPincodes(value: string) {
  return [...new Set(value.split(/[,\n]+/).map(pin => pin.trim()).filter(Boolean))];
}

export function sellerProfileSnapshot(form: ReturnType<typeof sellerProfileForm>) {
  return JSON.stringify({
    ...form,
    excludedStates: [...new Set(form.excludedStates)].sort(),
    excludedPincodes: parseExcludedPincodes(form.excludedPincodes).sort(),
  });
}
