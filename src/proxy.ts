import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/basic-auth";

export function proxy(request: NextRequest) {
  const decision = checkBasicAuth(request.headers.get("authorization"), {
    user: process.env.BASIC_AUTH_USER,
    password: process.env.BASIC_AUTH_PASSWORD,
    isProduction: process.env.NODE_ENV === "production",
  });

  if (decision === "allow") return NextResponse.next();
  if (decision === "not_configured") {
    return new NextResponse("Accès non configuré : définissez BASIC_AUTH_PASSWORD.", { status: 503 });
  }
  return new NextResponse("Authentification requise", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PFlow Bots", charset="UTF-8"' },
  });
}

export const config = {
  // Tout est protégé, sauf les fichiers statiques et le futur webhook WhatsApp
  // (Meta doit pouvoir l'appeler ; il sera protégé par la signature X-Hub-Signature-256).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks/).*)"],
};
