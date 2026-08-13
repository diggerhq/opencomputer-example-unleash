import { isEnabled } from "./flags.js";

export function invoiceRenderer(invoice) {
  // This flag is deliberately disabled in production in the recommended setup.
  if (isEnabled("invoice-pdf-v2")) {
    return { template: "accessible-pdf", invoice };
  }

  return { template: "classic-pdf", invoice };
}
