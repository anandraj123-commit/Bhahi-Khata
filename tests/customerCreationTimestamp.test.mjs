import assert from "node:assert/strict";
import test from "node:test";
import {
  customerCreateSchema,
  customerSchema,
} from "../server/src/validators/schemas.js";
import { customerOut } from "../server/src/utils/serializers.js";

const customer = {
  id: "customer-1",
  name: "Rahul Kumar",
  phone: "",
  address: "Village Paraiya, Gaya",
  opening: 0,
  openingAdvance: 0,
  limit: 0,
  reminder: true,
};

test("customer creation accepts an original creation timestamp", () => {
  const createdAt = "2026-10-15T09:30:00.000Z";
  assert.equal(customerCreateSchema.parse({ ...customer, createdAt }).createdAt, createdAt);
});

test("customer update schema rejects Created On so edits cannot change it", () => {
  assert.equal(customerSchema.safeParse({
    ...customer,
    createdAt: "2026-10-15T09:30:00.000Z",
}).success, false);
});

test("customer API serialization exposes the persisted creation timestamp", () => {
  const createdAt = new Date("2026-10-15T09:30:00.000Z");
  const output = customerOut({
    clientId: customer.id,
    createdAt,
    openingDate: new Date("2026-10-15T00:00:00.000Z"),
    openingPaise: 0,
    openingAdvancePaise: 0,
    limitPaise: 0,
    ...customer,
  });
  assert.equal(output.createdAt, createdAt.toISOString());
});
