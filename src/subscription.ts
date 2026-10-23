export type SubscriptionPlan = {
  id: string;
  code: "free" | "pro" | "business";
  name: string;
  description: string;
  monthlyPriceMinor: number;
  currency: string;
  customerLimit: number | null;
  unlimitedCustomers: boolean;
  configurationVersion: number;
  pricingVersion: number;
  entitlements: Record<string, unknown>;
  features: string[];
  enabled: boolean;
  displayOrder: number;
  durations: {
    months: number;
    durationMonths: number;
    basePriceMinor: number;
    originalAmountMinor: number;
    discountPercent: number;
    discountAmountMinor: number;
    discountedAmountMinor: number;
    taxableAmountMinor: number;
    taxPercent: number;
    taxRateBps: number;
    taxInclusive: boolean;
    taxAmountMinor: number;
    finalAmountMinor: number;
    isActive: boolean;
    pricingVersion: number;
    currency: string;
  }[];
};

export type CurrentSubscription = {
  shopId: string;
  id: string | null;
  plan: {
    code: string;
    name: string;
    customerLimit: number | null;
    unlimitedCustomers: boolean;
    entitlements: Record<string, unknown>;
    configurationVersion: number;
  };
  status: "active";
  /** Derived from the last verified expiry while offline; never grants access. */
  offlineExpired?: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  durationMonths: number;
  amountPaidMinor: number | null;
  remainingMilliseconds: number | null;
  remainingDays: number | null;
  remainingHours: number | null;
  isFallback: boolean;
  scheduled: null | {
    id: string;
    plan: { code: string; name: string; customerLimit: number | null; unlimitedCustomers: boolean; entitlements: Record<string, unknown>; configurationVersion: number };
    startsAt: string;
    expiresAt: string | null;
    durationMonths: number;
  };
  customerUsage: { used: number; limit: number | null; unlimited: boolean; remaining: number | null };
  verifiedAt: string;
  lastSyncedAt: string;
  entitlementVersion: number;
};

export type SubscriptionSnapshot = {
  plans: SubscriptionPlan[];
  current: CurrentSubscription;
  history: {
    id: string;
    plan: { name?: string; code?: string };
    status: "active" | "scheduled" | "expired" | "cancelled" | "superseded";
    startsAt: string | null;
    expiresAt: string | null;
    durationMonths: number;
    amountPaidMinor: number | null;
    remainingMilliseconds: number | null;
    remainingDays: number | null;
    startsInMilliseconds: number | null;
    startsInDays: number | null;
    createdAt: string;
  }[];
  payments: any[];
  checkoutEnabled: boolean;
  provider: string;
  cachedAt?: number;
  entitlementLastVerifiedAt?: string;
  notificationsGranted?: boolean;
  localNotificationIds?: string[];
  paymentsNextCursor?: string | null;
  historyNextCursor?: string | null;
};
