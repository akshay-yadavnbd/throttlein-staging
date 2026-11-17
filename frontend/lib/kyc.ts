import { useEffect, useState, useCallback } from 'react';
import { api, unwrap } from '@/lib/api';
import { apiMessage } from '@/lib/notify';

export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';

export type KycPickupAddress = {
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
};

export type KycBankDetails = {
  accountHolder?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  cancelledCheque?: string;
};

export type Kyc = {
  status: KycStatus;
  gstin?: string;
  pan?: string;
  gstCertificate?: string;
  panCard?: string;
  pickupAddress?: KycPickupAddress;
  bankDetails?: KycBankDetails;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};

const EMPTY_KYC: Kyc = { status: 'not_started' };

export type AccountStatus = 'pending' | 'approved' | 'suspended';

/**
 * Hook to read the current seller's KYC state AND account status.
 * Two-step approval flow:
 *   - kyc.status === 'approved'        → documents verified
 *   - accountStatus === 'approved'     → store is live (set by admin separately)
 * Seller can only list products when BOTH are true.
 */
export function useKycStatus() {
  const [kyc, setKyc] = useState<Kyc>(EMPTY_KYC);
  const [revision, setRevision] = useState<Kyc | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = unwrap<{ kyc?: any; revision?: any; accountStatus?: AccountStatus }>(await api.get('/seller/kyc'));
      setKyc(data.kyc || EMPTY_KYC);
      setRevision(data.revision || null);
      if (data.accountStatus) setAccountStatus(data.accountStatus);
    } catch (e: any) {
      setError(apiMessage(e) || 'Failed to load KYC status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const fullyApproved =
    kyc.status === 'approved' && accountStatus === 'approved';

  return { kyc, revision, accountStatus, fullyApproved, loading, error, refresh };
}

/**
 * Human-friendly copy + tint per status.
 */
export const KYC_STATUS_META: Record<KycStatus, {
  label: string;
  short: string;
  tone: 'amber' | 'blue' | 'emerald' | 'rose';
}> = {
  not_started: { label: 'KYC not submitted',  short: 'Action needed', tone: 'amber' },
  pending:     { label: 'KYC under review',   short: 'Reviewing',     tone: 'blue' },
  approved:    { label: 'KYC verified',       short: 'Verified',      tone: 'emerald' },
  rejected:    { label: 'KYC needs fixing',   short: 'Rejected',      tone: 'rose' },
};
