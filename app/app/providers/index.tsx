"use client";

import { ReactNode } from "react";
import { ClusterProvider } from "./cluster-provider";
import { WalletProvider } from "./wallet-provider";
import { QueryProvider } from "./query-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ClusterProvider>
        <WalletProvider>{children}</WalletProvider>
      </ClusterProvider>
    </QueryProvider>
  );
}
