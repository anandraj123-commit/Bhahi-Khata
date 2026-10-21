import type { Customer } from "./model";

export type CustomerLifecycleState = "active" | "disabled" | "removed";
export type CustomerLifecycleFlags = Pick<Customer, "status" | "disabled" | "removed">;

export const ACTIVE_CUSTOMER: CustomerLifecycleFlags = {
  status: true,
  disabled: false,
  removed: false,
};

export function normalizeCustomerLifecycle<T extends Partial<Customer>>(customer: T): T & CustomerLifecycleFlags {
  const flags = [customer.status, customer.disabled, customer.removed];
  if (flags.every((value) => value === undefined))
    return { ...customer, ...ACTIVE_CUSTOMER };
  if (flags.some((value) => typeof value !== "boolean"))
    throw new Error("Invalid customer lifecycle status");
  const activeCount = flags.filter(Boolean).length;
  if (activeCount !== 1) throw new Error("Invalid customer lifecycle status");
  return customer as T & CustomerLifecycleFlags;
}

export function customerLifecycleState(customer: Partial<Customer>): CustomerLifecycleState {
  const normalized = normalizeCustomerLifecycle(customer);
  return normalized.status ? "active" : normalized.disabled ? "disabled" : "removed";
}

export function transitionCustomerLifecycle(
  customer: Customer,
  target: CustomerLifecycleState,
): Customer {
  const current = customerLifecycleState(customer);
  const allowed: Record<CustomerLifecycleState, CustomerLifecycleState[]> = {
    active: ["disabled", "removed"],
    disabled: ["active", "removed"],
    removed: ["active"],
  };
  if (current === target) return customer;
  if (!allowed[current].includes(target))
    throw new Error(`Invalid customer lifecycle transition: ${current} to ${target}`);
  return {
    ...customer,
    status: target === "active",
    disabled: target === "disabled",
    removed: target === "removed",
  };
}

export function isActiveCustomer(customer: Partial<Customer>) {
  return customerLifecycleState(customer) === "active";
}

export function matchesCustomerLifecycleFilter(
  customer: Partial<Customer>,
  filter: "All" | "Disabled" | "Removed",
) {
  const state = customerLifecycleState(customer);
  return filter === "All"
    ? state === "active"
    : filter === "Disabled"
      ? state === "disabled"
      : state === "removed";
}
