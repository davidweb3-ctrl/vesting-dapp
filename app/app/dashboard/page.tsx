"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgram } from "../hooks/useVestingProgram";
import { VestingCard } from "../components/vesting-card";

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { adminVestings, beneficiaryVestings, deposit, claim } =
    useVestingProgram();

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 mt-2">
          View and manage all your vesting schedules.
        </p>
      </div>

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
                {adminVestings.data.map((v) => (
                  <VestingCard
                    key={v.publicKey.toString()}
                    pubkey={v.publicKey}
                    account={v.account}
                    role="admin"
                    onDeposit={() =>
                      deposit.mutate({
                        vestingPda: v.publicKey,
                        mint: v.account.mint,
                      })
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
                {beneficiaryVestings.data.map((v) => (
                  <VestingCard
                    key={v.publicKey.toString()}
                    pubkey={v.publicKey}
                    account={v.account}
                    role="beneficiary"
                    onClaim={() =>
                      claim.mutate({
                        vestingPda: v.publicKey,
                        mint: v.account.mint,
                      })
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
