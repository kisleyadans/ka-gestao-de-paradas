import { env } from "cloudflare:workers";

const COOKIE_NAME = "ka_pcm_operator";
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type OperatorSession = {
  name: string;
};

function runtimeEnv() {
  return env as unknown as Record<string, unknown>;
}

export function operatorPassword() {
  const value = runtimeEnv().PCM_OPERATOR_PASSWORD;
  return typeof value === "string" ? value : "";
}

function sessionSecret() {
  const value = runtimeEnv().PCM_SESSION_SECRET;
  return typeof value === "string" ? value : "";
}

export function safeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(value: string) {
  const secret = sessionSecret();
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function encodeBase64Url(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return decoder.decode(bytes);
}

export function normalizeOperatorName(value: unknown) {
  if (typeof value !== "string") return "Operador PCM";
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return normalized || "Operador PCM";
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

export async function getOperatorSession(request: Request): Promise<OperatorSession | null> {
  const token = readCookie(request, COOKIE_NAME);
  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;

  const expiresText = parts[0];
  const expiresAt = Number(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;

  if (parts.length === 2) {
    const expectedSignature = await sign(`pcm-operator:${expiresText}`);
    return Boolean(expectedSignature) && safeEqual(parts[1], expectedSignature)
      ? { name: "Operador PCM" }
      : null;
  }

  const encodedName = parts[1];
  const receivedSignature = parts[2];
  const expectedSignature = await sign(`pcm-operator:${expiresText}:${encodedName}`);
  if (!expectedSignature || !safeEqual(receivedSignature, expectedSignature)) return null;

  try {
    return { name: normalizeOperatorName(decodeBase64Url(encodedName)) };
  } catch {
    return null;
  }
}

export async function isOperatorRequest(request: Request) {
  return Boolean(await getOperatorSession(request));
}

export async function createOperatorCookie(name: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const encodedName = encodeBase64Url(normalizeOperatorName(name));
  const signature = await sign(`pcm-operator:${expiresAt}:${encodedName}`);
  if (!signature) throw new Error("PCM_SESSION_SECRET is not configured");
  const token = encodeURIComponent(`${expiresAt}.${encodedName}.${signature}`);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearOperatorCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function clientRateLimitKey(request: Request) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  return (await sign(`pcm-client:${address}`)).slice(0, 48) || "unknown";
}
