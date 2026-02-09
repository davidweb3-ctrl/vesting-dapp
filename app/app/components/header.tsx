"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useCluster, Cluster } from "../providers/cluster-provider";

// 动态导入 WalletMultiButton，禁用 SSR 以避免 hydration 错误
const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/create", label: "Create Vesting" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/claim", label: "Claim" },
];

const clusters: Cluster[] = ["devnet", "testnet", "mainnet-beta", "localnet"];

export function Header() {
  const pathname = usePathname();
  const { cluster, setCluster } = useCluster();

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold text-white">
            Vesting<span className="text-indigo-400">DApp</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-indigo-600/20 text-indigo-400"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={cluster}
            onChange={(e) => setCluster(e.target.value as Cluster)}
            className="bg-zinc-900 text-zinc-300 text-sm border border-zinc-700 rounded-lg px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            {clusters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
