import { isEnabled } from "./flags.js";

function legacyCheckout(cart) {
  return {
    flow: "legacy",
    itemCount: cart.items.length,
    supportsExpressPay: false,
  };
}

function modernCheckout(cart) {
  return {
    flow: "modern",
    itemCount: cart.items.length,
    supportsExpressPay: true,
  };
}

export function createCheckout(cart) {
  if (isEnabled("fixture-checkout-v2")) {
    return modernCheckout(cart);
  }

  return legacyCheckout(cart);
}
