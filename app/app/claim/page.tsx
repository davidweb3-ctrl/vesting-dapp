"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgram } from "../hooks/useVestingProgram";
import { VestingCard } from "../components/vesting-card";
import { useState } from "react";

export default function ClaimPage() {
  const { publicKey } = useWallet();
  const { beneficiaryVestings, claim } = useVestingProgram();
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!publicKey) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-white">
            Connect Your Wallet
          </h2>
          <p className="text-zinc-400">
            Connect your wallet to claim your vested tokens.
          </p>
        </div>
      </div>
    );
  }

  const handleClaim = async (vestingPda: any, mint: any) => {
    setError(null);
    setTxSig(null);
    try {
      const tx = await claim.mutateAsync({ vestingPda, mint });
      // Check if user cancelled (null return value)
      if (tx === null) {
        // User cancelled, silently return
        return;
      }
      setTxSig(tx);
    } catch (err: any) {
      
      // Map Anchor error codes to user-friendly messages
      const errorCode = err?.error?.errorCode?.code;
      let displayError = err?.error?.errorMessage || err?.message || "Claim failed";
      
      if (errorCode === "NotFunded") {
        displayError = "Not funded: Admin must deposit tokens into the vault before claiming. Please contact the admin to deposit tokens.";
      } else if (errorCode === "NothingToClaim") {
        displayError = "Nothing to claim: No tokens are available for release at this time. Either the cliff period hasn't passed, or all tokens have already been claimed.";
      } else if (errorCode === "UnauthorizedBeneficiary") {
        displayError = "Unauthorized: Only the beneficiary can claim tokens from this vesting schedule.";
      }
      
      setError(displayError);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Claim Tokens</h1>
        <p className="text-zinc-400 mt-2">
          View and claim your vested tokens.
        </p>
      </div>

      {txSig && (
        <div className="bg-green-950/50 border border-green-800 rounded-lg p-4">
          <p className="text-green-400 text-sm font-medium">
            Tokens claimed successfully!
          </p>
          <p className="text-green-500/70 text-xs mt-1 font-mono break-all">
            TX: {txSig}
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4">
          <p className="text-red-400 text-sm font-medium">Error</p>
          <p className="text-red-500/70 text-xs mt-1">{error}</p>
        </div>
      )}

      {beneficiaryVestings.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
        </div>
      ) : beneficiaryVestings.data &&
        beneficiaryVestings.data.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {beneficiaryVestings.data.map((v: any) => (
            <VestingCard
              key={v.publicKey.toString()}
              pubkey={v.publicKey}
              account={{
                ...v.account,
                vaultBalance: v.vaultBalance,
                isFunded: v.isFunded,
              }}
              decimals={v.decimals}
              role="beneficiary"
              onClaim={() => handleClaim(v.publicKey, v.account.mint)}
              isClaiming={claim.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-zinc-800 rounded-xl">
          <p className="text-zinc-500 text-lg">No vesting schedules found</p>
          <p className="text-zinc-600 text-sm mt-2">
            You don&apos;t have any token vestings assigned to your wallet.
          </p>
        </div>
      )}
    </div>
  );
}
