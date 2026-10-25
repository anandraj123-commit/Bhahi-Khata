/** Keep the opt-in contact copy in form state; it is never persisted as a rule. */
export function updateCustomerContactForm(form: Record<string, string>, key: string, value: string) {
  const next = { ...form, [key]: value };
  if ((key === "phone" && form.sameAsMobile === "true") ||
      (key === "sameAsMobile" && value === "true")) {
    next.whatsappNumber = next.phone || "";
  }
  return next;
}
