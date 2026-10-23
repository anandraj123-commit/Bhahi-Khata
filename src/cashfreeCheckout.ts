/** Cashfree checkout is loaded only when requested so Expo Go can still open the app. */
export async function launchCashfreeCheckout(input: {
  paymentSessionId: string;
  gatewayOrderId: string;
  environment: "sandbox" | "production";
}): Promise<void> {
  const [{ CFPaymentGatewayService }, { CFEnvironment, CFSession }] = await Promise.all([
    import("react-native-cashfree-pg-sdk"),
    import("cashfree-pg-api-contract"),
  ]);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      CFPaymentGatewayService.removeCallback();
      if (error) reject(error);
      else resolve();
    };
    CFPaymentGatewayService.setCallback({
      onVerify: (orderId) => {
        if (orderId !== input.gatewayOrderId) finish(new Error("Cashfree returned a different order"));
        else finish();
      },
      onError: () => finish(new Error("Cashfree checkout closed before confirmation")),
    });
    try {
      const environment = input.environment === "sandbox" ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION;
      CFPaymentGatewayService.doWebPayment(
        new CFSession(input.paymentSessionId, input.gatewayOrderId, environment),
      );
    } catch {
      finish(new Error("Cashfree checkout is unavailable in this app build"));
    }
  });
}
