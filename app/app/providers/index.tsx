"use client";

import { ReactNode, useEffect } from "react";
import { ClusterProvider } from "./cluster-provider";
import { WalletProvider } from "./wallet-provider";
import { QueryProvider } from "./query-provider";

// Intercept console.error to suppress wallet rejection errors
// The wallet adapter calls console.error internally before throwing,
// and Next.js dev overlay catches these console outputs and shows them.
function useSupressWalletErrors() {
  useEffect(() => {
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      // Check if any argument is or contains a wallet rejection error
      const isWalletRejection = args.some((arg) => {
        if (arg instanceof Error) {
          return (
            arg.name === "WalletSignTransactionError" ||
            arg.message?.includes("User rejected") ||
            arg.message?.includes("user rejected")
          );
        }
        if (typeof arg === "string") {
          return (
            arg.includes("WalletSignTransactionError") ||
            arg.includes("User rejected") ||
            arg.includes("user rejected")
          );
        }
        return false;
      });

      if (isWalletRejection) {
        // Suppress: don't log wallet rejection to console
        return;
      }

      // Pass through all other errors
      originalConsoleError.apply(console, args);
    };

    return () => {
      console.error = originalConsoleError;
    };
  }, []);
}

export function AppProviders({ children }: { children: ReactNode }) {
  useSupressWalletErrors();

  return (
    <QueryProvider>
      <ClusterProvider>
        <WalletProvider>{children}</WalletProvider>
      </ClusterProvider>
    </QueryProvider>
  );
}
