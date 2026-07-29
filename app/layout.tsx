import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "para360-demonstracao.kisleyadans.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "K.A - Gestão de Paradas";
  const description = "Centro de controle para planejamento, execução, bloqueios, Curva S e acompanhamento completo de paradas industriais.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1736, height: 909, alt: "K.A - Gestão de Paradas" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
