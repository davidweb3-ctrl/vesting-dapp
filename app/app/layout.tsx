import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "./providers";
import { Header } from "./components/header";

export const metadata: Metadata = {
  title: "Vesting DApp - Secure Token Vesting on Solana",
  description:
    "Create, manage, and claim token vestings with on-chain security and transparency.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-white antialiased min-h-screen">
        <AppProviders>
          <Header />
          <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
