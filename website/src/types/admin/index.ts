export type Role = "SUPER_ADMIN" | "ADMIN" | "SUPPORT";
export type Administrator = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};
export type AdminSession = {
  administrator: Administrator;
  permissions: string[];
  csrfToken: string;
  expiresAt: string;
  reauthenticatedAt: string | null;
};
export type Pagination = { page: number; limit: number; total: number };
export type Envelope<T> = { data: T; pagination?: Pagination };
export type DataRow = { _id?: string; id?: string; [key: string]: unknown };
export type Series = { _id: string; count: number }[];
export type Dashboard = {
  metrics: {
    totalShops: number;
    activeShops: number;
    totalSubscriptions: number;
    activeSubscriptions: number;
    expiringSubscriptions: number;
    expiredSubscriptions: number;
    recentRegistrations: number;
    revenue: { _id: string; amountMinor: number; count: number }[];
  };
  registrations: Series;
  subscriptionGrowth: Series;
  distribution: Series;
  revenueTrend: {
    _id: { date: string; currency: string };
    amountMinor: number;
  }[];
  recentShops: DataRow[];
  recentAudit: DataRow[];
  plans: DataRow[];
  definitions: {
    activeShops: string;
    subscriptions: string;
    expiring: string;
    revenue: string;
    activeShopTrend: string;
  };
  period: { from: string; to: string };
};
export type ShopDetail = {
  shop: DataRow;
  subscription: DataRow;
  history: DataRow[];
};
export type Settings = {
  administrator: Administrator;
  sessions: {
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }[];
};
