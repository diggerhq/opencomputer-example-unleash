export function createCheckout(cart) {
  return {
    flow: "modern",
    itemCount: cart.items.length,
    supportsExpressPay: true,
  };
}
