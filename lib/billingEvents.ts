"use client";

/** The billing panel and the school cards live side by side on /owner: when billing changes, the cards must follow. */
const EVENT = "billing-refresh";

export function refreshBilling() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onBillingRefresh(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
