export const ACTIVE_CUSTOMER_STATUS = Object.freeze({
  status: true,
  disabled: false,
  removed: false,
});

export function normalizeCustomerStatus(customer = {}) {
  const supplied = [customer.status, customer.disabled, customer.removed];
  if (supplied.every((value) => value === undefined)) return { ...customer, ...ACTIVE_CUSTOMER_STATUS };
  if (supplied.some((value) => typeof value !== "boolean") || supplied.filter(Boolean).length !== 1)
    throw Object.assign(new Error("Customer lifecycle flags are invalid"), { status: 400, code: "CUSTOMER_STATUS_INVALID" });
  return customer;
}

export function lifecycleTarget(target) {
  const values = {
    active: { status: true, disabled: false, removed: false },
    disabled: { status: false, disabled: true, removed: false },
    removed: { status: false, disabled: false, removed: true },
  };
  return values[target] || null;
}

export function canTransitionCustomerStatus(from, to) {
  if (from === to) return true;
  return ({ active: ["disabled", "removed"], disabled: ["active", "removed"], removed: ["active"] })[from]?.includes(to) || false;
}

export function customerStatusName(customer) {
  if (customer?.status === undefined && customer?.disabled === undefined && customer?.removed === undefined) return "active";
  if (customer.status === true && customer.disabled === false && customer.removed === false) return "active";
  if (customer.status === false && customer.disabled === true && customer.removed === false) return "disabled";
  if (customer.status === false && customer.disabled === false && customer.removed === true) return "removed";
  return "invalid";
}
