"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { clusterApiUrl } from "@solana/web3.js";

export type Cluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";

interface ClusterContextType {
  cluster: Cluster;
  setCluster: (cluster: Cluster) => void;
  endpoint: string;
}

const ClusterContext = createContext<ClusterContextType>({
  cluster: "devnet",
  setCluster: () => {},
  endpoint: clusterApiUrl("devnet"),
});

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [cluster, setCluster] = useState<Cluster>("devnet");

  const endpoint =
    cluster === "localnet"
      ? "http://localhost:8899"
      : clusterApiUrl(cluster);

  return (
    <ClusterContext.Provider value={{ cluster, setCluster, endpoint }}>
      {children}
    </ClusterContext.Provider>
  );
}

export function useCluster() {
  return useContext(ClusterContext);
}
