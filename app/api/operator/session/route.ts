import { env } from "cloudflare:workers";
import {
  clearOperatorCookie,
  clientRateLimitKey,
  createOperatorCookie,
  getOperatorSession,
  normalizeOperatorName,
  operatorPassword,
  safeEqual,
} from "../../../../lib/operator-auth";

const MAX_ATTEMPTS = 6;
const WINDOW_MINUTES = 15;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function database() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("Banco de dados indisponível");
  return db;
}

async function rateLimitStatus(request: Request) {
  const db = database();
  const clientKey = await clientRateLimitKey(request);
  const row = await db
    .prepare("SELECT attempts, window_started_at FROM auth_attempts WHERE client_key = ?")
    .bind(clientKey)
    .first<{ attempts: number; window_started_at: string }>();

  if (!row) return { blocked: false, clientKey };
  const windowAge = Date.now() - new Date(row.window_started_at).getTime();
  const windowActive = Number.isFinite(windowAge) && windowAge < WINDOW_MINUTES * 60_000;
  return { blocked: windowActive && row.attempts >= MAX_ATTEMPTS, clientKey };
}

async function recordFailure(clientKey: string) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  await database()
    .prepare(`
      INSERT INTO auth_attempts (client_key, attempts, window_started_at)
      VALUES (?, 1, ?)
      ON CONFLICT(client_key) DO UPDATE SET
        attempts = CASE WHEN window_started_at < ? THEN 1 ELSE attempts + 1 END,
        window_started_at = CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END
    `)
    .bind(clientKey, now, cutoff, cutoff)
    .run();
}

async function clearFailures(clientKey: string) {
  await database().prepare("DELETE FROM auth_attempts WHERE client_key = ?").bind(clientKey).run();
}

export async function GET(request: Request) {
  const session = await getOperatorSession(request);
  return noStoreJson({ operator: Boolean(session), name: session?.name ?? "" });
}

export async function POST(request: Request) {
  try {
    const configuredPassword = operatorPassword();
    if (!configuredPassword) {
      return noStoreJson({ error: "Acesso de operador ainda não configurado" }, { status: 503 });
    }

    const { blocked, clientKey } = await rateLimitStatus(request);
    if (blocked) {
      return noStoreJson(
        { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
        { status: 429 },
      );
    }

    const payload = (await request.json()) as { password?: string; name?: string };
    const suppliedPassword = typeof payload.password === "string" ? payload.password : "";
    if (!safeEqual(suppliedPassword, configuredPassword)) {
      await recordFailure(clientKey);
      return noStoreJson({ error: "Senha incorreta" }, { status: 401 });
    }

    await clearFailures(clientKey);
    const name = normalizeOperatorName(payload.name);
    return noStoreJson(
      { operator: true, name },
      { headers: { "Set-Cookie": await createOperatorCookie(name) } },
    );
  } catch (error) {
    console.error("Operator login failed", error);
    return noStoreJson({ error: "Não foi possível liberar o acesso agora" }, { status: 500 });
  }
}

export async function DELETE() {
  return noStoreJson(
    { operator: false },
    { headers: { "Set-Cookie": clearOperatorCookie() } },
  );
}
