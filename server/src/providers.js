import { timingSafeEqual } from "node:crypto";

const env = process.env;
export async function sendOtp(phone) {
  if (
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_VERIFY_SERVICE_SID
  ) {
    const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`;
    const body = new URLSearchParams({ To: phone, Channel: "sms" });
    const auth = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64");
    const result = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!result.ok) throw new Error("OTP provider rejected the request");
    return { channel: "sms" };
  }
  if (env.NODE_ENV !== "production" && env.DEV_OTP_ENABLED === "true")
    return {
      channel: "development",
      developmentCode: env.DEV_OTP_CODE || "123456",
    };
  throw new Error("OTP service is not configured");
}
export function isSmsConfigured() {
  return Boolean(
    env.FREE2SMS_API_KEY &&
      env.FREE2SMS_SENDER_ID &&
      env.FREE2SMS_SMS_TEMPLATE &&
      ["transactional", "promotional", "otp"].includes(
        env.FREE2SMS_ROUTE || "transactional",
      ),
  );
}
export async function sendSms(phone, { customer, shop, amount }) {
  if (!isSmsConfigured()) throw new Error("SMS messaging is not configured");
  const digits = String(phone).replace(/\D/g, "");
  const number = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
  if (!/^[6-9]\d{9}$/.test(number))
    throw new Error("Free2SMS requires a valid Indian mobile number");
  const values = {
    customer: String(customer).replace(/[\r\n]/g, " ").trim().slice(0, 80),
    shop: String(shop).replace(/[\r\n]/g, " ").trim().slice(0, 80),
    amount: Number(amount).toFixed(2),
  };
  const message = env.FREE2SMS_SMS_TEMPLATE.replace(
    /\{\{(customer|shop|amount)\}\}/g,
    (_, key) => values[key],
  );
  if (/\{\{[^}]+\}\}/.test(message))
    throw new Error("SMS template contains an unsupported placeholder");
  const body = {
    numbers: number,
    message,
    sender_id: env.FREE2SMS_SENDER_ID,
    route: env.FREE2SMS_ROUTE || "transactional",
    sms_type: "dlt",
    ...(env.FREE2SMS_TEMPLATE_ID
      ? { template_id: Number(env.FREE2SMS_TEMPLATE_ID) }
      : {}),
  };
  const response = await fetch("https://free2sms.com/api/v1/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.FREE2SMS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true)
    throw new Error("Free2SMS rejected the SMS request");
  return result;
}
export async function verifyOtp(phone, code) {
  if (
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_VERIFY_SERVICE_SID
  ) {
    const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
    const body = new URLSearchParams({ To: phone, Code: code });
    const auth = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64");
    const result = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!result.ok) return false;
    return (await result.json()).status === "approved";
  }
  if (env.NODE_ENV !== "production" && env.DEV_OTP_ENABLED === "true") {
    const expected = Buffer.from(env.DEV_OTP_CODE || "123456");
    const got = Buffer.from(String(code));
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
  throw new Error("OTP service is not configured");
}
export async function sendPush(tokens, title, body) {
  if (!tokens.length) return;
  const receipts = [];
  for (let offset = 0; offset < tokens.length; offset += 100) {
    const messages = tokens
      .slice(offset, offset + 100)
      .map((to) => ({ to, title, body, sound: "default", priority: "high" }));
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.EXPO_ACCESS_TOKEN
          ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error("Push provider request failed");
    const result = await response.json();
    receipts.push(
      ...(Array.isArray(result.data) ? result.data : [result.data]),
    );
  }
  return { data: receipts };
}
export async function sendWhatsApp(phone, templateName, parameters) {
  if (
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_ACCESS_TOKEN ||
    !templateName
  )
    throw new Error("WhatsApp Cloud API is not configured");
  const version = env.WHATSAPP_API_VERSION || "v23.0";
  const body = {
    messaging_product: "whatsapp",
    to: phone.replace("+", ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: parameters.map((text) => ({
            type: "text",
            text: String(text).slice(0, 1000),
          })),
        },
      ],
    },
  };
  const response = await fetch(
    `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error("WhatsApp provider request failed");
  return response.json();
}
