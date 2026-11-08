/**
 * Commande de démo validée sur la page Mint Bun du CRM (order.pflow.fr/demo/commande?r=pflow&j=<jeton>) :
 * confirmation « Commande enregistrée » puis étape 2/3 sur WhatsApp (src/demos/demo-auto.ts). Public (hors mot
 * de passe de l'app, src/proxy.ts) : le jeton chiffré du contact fait foi. CORS : order.pflow.fr seulement
 * (+ PFLOW_DEMO_ORIGINES, séparées par des virgules, pour une préversion). Corps en text/plain (pas de pré-vol).
 */
import { NextResponse } from "next/server";
import { DEMO_ORDER_ORIGINS, handleDemoOrder } from "@/demos/demo-auto";
import { demoAutoDeps } from "@/demos/demo-auto-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedOrigin(origin: string | null): string | null {
  const extra = (process.env.PFLOW_DEMO_ORIGINES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin && [...DEMO_ORDER_ORIGINS, ...extra].includes(origin) ? origin : null;
}

function cors(origin: string | null): Record<string, string> {
  const allowed = allowedOrigin(origin);
  return allowed ? { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {};
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = { ...cors(origin), "Cache-Control": "no-store" };
  if (origin && !allowedOrigin(origin)) return NextResponse.json({ ok: false, erreur: "origine refusée" }, { status: 403, headers });
  const text = await request.text();
  if (text.length > 20_000) return NextResponse.json({ ok: false, erreur: "commande trop longue" }, { status: 413, headers });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, erreur: "commande illisible" }, { status: 400, headers });
  }
  const deps = await demoAutoDeps();
  if (!deps) return NextResponse.json({ ok: false, erreur: "WhatsApp non configuré" }, { status: 503, headers });
  try {
    const result = await handleDemoOrder(deps, body);
    if (!result.ok) return NextResponse.json(result, { status: result.status, headers });
    return NextResponse.json(result, { headers });
  } catch (error) {
    console.error("[demo] commande :", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, erreur: "erreur serveur" }, { status: 500, headers });
  }
}
