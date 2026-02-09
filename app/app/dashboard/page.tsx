"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgram } from "../hooks/useVestingProgram";
import { VestingCard } from "../components/vesting-card";

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { adminVestings, beneficiaryVestings, deposit, claim } =
    useVestingProgram();
  const [depositError, setDepositError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  if (!publicKey) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-white">
            Connect Your Wallet
          </h2>
          <p className="text-zinc-400">
            Connect your wallet to view your vesting schedules.
          </p>
        </div>
      </div>
    );
  }

  const isLoading = adminVestings.isLoading || beneficiaryVestings.isLoading;

  // Handle deposit with error handling
  const handleDeposit = async (vestingPda: any, mint: any) => {
    setDepositError(null);
    setDepositSuccess(null);
    try {
      const tx = await deposit.mutateAsync({ vestingPda, mint });
      // Check if user cancelled (null return value)
      if (tx === null) {
        // User cancelled, silently return
        return;
      }
      setDepositSuccess(tx);
      // Clear success message after 5 seconds
      setTimeout(() => setDepositSuccess(null), 5000);
    } catch (err: any) {
      // Show actual errors
      const errorCode = err?.error?.errorCode?.code;
      let errorMsg = err?.error?.errorMessage || err?.message || "Deposit failed";
      
      if (errorCode === "AlreadyFunded") {
        errorMsg = "Vault is already funded. Each vesting can only be deposited once.";
      } else if (errorCode === "UnauthorizedAdmin") {
        errorMsg = "Unauthorized: Only the admin who created this vesting can deposit.";
      } else if (errorCode === "MintMismatch") {
        errorMsg = "Mint mismatch: The token mint does not match the vesting schedule.";
      }
      
      setDepositError(errorMsg);
      setTimeout(() => setDepositError(null), 10000);
    }
  };

  // Handle claim with error handling
  const handleClaim = async (vestingPda: any, mint: any) => {
    setClaimError(null);
    setClaimSuccess(null);
    try {
      const tx = await claim.mutateAsync({ vestingPda, mint });
      // Check if user cancelled (null return value)
      if (tx === null) {
        // User cancelled, silently return
        return;
      }
      setClaimSuccess(tx);
      setTimeout(() => setClaimSuccess(null), 5000);
    } catch (err: any) {
      const errorCode = err?.error?.errorCode?.code;
      let errorMsg = err?.error?.errorMessage || err?.message || "Claim failed";
      
      if (errorCode === "NotFunded") {
        errorMsg = "Not funded: Admin must deposit tokens into the vault before claiming.";
      } else if (errorCode === "NothingToClaim") {
        errorMsg = "Nothing to claim: No tokens are available for release at this time.";
      } else if (errorCode === "UnauthorizedBeneficiary") {
        errorMsg = "Unauthorized: Only the beneficiary can claim tokens.";
      }
      
      setClaimError(errorMsg);
      setTimeout(() => setClaimError(null), 10000);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 mt-2">
          View and manage all your vesting schedules.
        </p>
      </div>

      {/* Success Messages */}
      {depositSuccess && (
        <div className="bg-green-950/50 border border-green-800 rounded-lg p-4">
          <p className="text-green-400 text-sm font-medium">
            Deposit successful!
          </p>
          <p className="text-green-500/70 text-xs mt-1 font-mono break-all">
            TX: {depositSuccess}
          </p>
        </div>
      )}

      {claimSuccess && (
        <div className="bg-green-950/50 border border-green-800 rounded-lg p-4">
          <p className="text-green-400 text-sm font-medium">
            Claim successful!
          </p>
          <p className="text-green-500/70 text-xs mt-1 font-mono break-all">
            TX: {claimSuccess}
          </p>
        </div>
      )}

      {/* Error Messages */}
      {depositError && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4">
          <p className="text-red-400 text-sm font-medium">Deposit Error</p>
          <p className="text-red-500/70 text-xs mt-1">{depositError}</p>
        </div>
      )}

      {claimError && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4">
          <p className="text-red-400 text-sm font-medium">Claim Error</p>
          <p className="text-red-500/70 text-xs mt-1">{claimError}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
        </div>
      ) : (
        <>
          {/* Admin vestings */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              Created by You
              <span className="text-sm font-normal text-zinc-500">
                (Admin)
              </span>
            </h2>
            {adminVestings.data && adminVestings.data.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {adminVestings.data.map((v: any) => (
                  <VestingCard
                    key={v.publicKey.toString()}
                    pubkey={v.publicKey}
                    account={{
                      ...v.account,
                      vaultBalance: v.vaultBalance,
                      isFunded: v.isFunded,
                    }}
                    decimals={v.decimals}
                    role="admin"
                    onDeposit={
                      !v.isFunded
                        ? () => handleDeposit(v.publicKey, v.account.mint)
                        : undefined
                    }
                    isDepositing={deposit.isPending}
                  />
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 py-8 text-center border border-zinc-800 rounded-xl">
                No vestings created by this wallet.
              </p>
            )}
          </section>

          {/* Beneficiary vestings */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              Assigned to You
              <span className="text-sm font-normal text-zinc-500">
                (Beneficiary)
              </span>
            </h2>
            {beneficiaryVestings.data &&
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
                    onClaim={() =>
                      handleClaim(v.publicKey, v.account.mint)
                    }
                    isClaiming={claim.isPending}
                  />
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 py-8 text-center border border-zinc-800 rounded-xl">
                No vestings assigned to this wallet.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
