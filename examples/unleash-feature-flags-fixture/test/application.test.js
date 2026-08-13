import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createCheckout } from "../src/checkout.js";
import { invoiceRenderer } from "../src/invoices.js";
import { profileNavigation, profilePage } from "../src/profile.js";
import { search } from "../src/search.js";

afterEach(() => {
  delete process.env.UNLEASH_FLAGS;
});

test("the production checkout behavior supports express pay", () => {
  process.env.UNLEASH_FLAGS = "fixture-checkout-v2";
  assert.deepEqual(createCheckout({ items: ["book"] }), {
    flow: "modern",
    itemCount: 1,
    supportsExpressPay: true,
  });
});

test("the production profile behavior uses cards and the new navigation", () => {
  process.env.UNLEASH_FLAGS = "profile-page-v2";
  assert.deepEqual(
    profilePage({ displayName: "Ada", permissions: ["profile:write"] }),
    { layout: "cards", displayName: "Ada", canEdit: true },
  );
  assert.deepEqual(profileNavigation(), ["Overview", "Activity", "Settings"]);
});

test("young and disabled flags retain their fallback behavior", () => {
  assert.equal(search("flags").engine, "keyword");
  assert.equal(invoiceRenderer({ id: "inv-1" }).template, "classic-pdf");
});
