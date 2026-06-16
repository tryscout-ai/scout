import { createHmac, randomBytes, timingSafeEqual } from "crypto";

type SlackOAuthStatePayload = {
  kind: "workspace" | "agent";
  id: string;
  returnTo: string;
  nonce: string;
  exp: number;
};

function stateSecret() {
  const secret = process.env.SLACK_CLIENT_SECRET;
  if (!secret) throw new Error("Missing SLACK_CLIENT_SECRET");
  return secret;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function createSlackOAuthState(payload: Omit<SlackOAuthStatePayload, "nonce" | "exp">) {
  const body = {
    ...payload,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const encodedBody = encodeBase64Url(JSON.stringify(body));
  const signature = createHmac("sha256", stateSecret()).update(encodedBody).digest("base64url");
  return `${encodedBody}.${signature}`;
}

export function verifySlackOAuthState(state: string) {
  const [encodedBody, signature] = state.split(".");
  if (!encodedBody || !signature) return null;

  const expectedSignature = createHmac("sha256", stateSecret()).update(encodedBody).digest("base64url");
  const actual = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encodedBody)) as SlackOAuthStatePayload;
    if (!payload?.kind || !payload.id || !payload.returnTo || !payload.nonce || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
