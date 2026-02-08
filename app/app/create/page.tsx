"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVestingProgram } from "../hooks/useVestingProgram";

export default function CreateVestingPage() {
  const { publicKey } = useWallet();
  const { createVesting } = useVestingProgram();

  const [beneficiary, setBeneficiary] = useState("");
  const [mint, setMint] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [cliffDate, setCliffDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [seed, setSeed] = useState(
    Math.floor(Math.random() * 1_000_000).toString()
  );
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTxSig(null);

    try {
      const beneficiaryPk = new PublicKey(beneficiary);
      const mintPk = new PublicKey(mint);
      const seedBn = new BN(seed);
      const amountBn = new BN(
        Math.floor(parseFloat(totalAmount) * 10 ** 6)
      );
      const startTs = new BN(Math.floor(new Date(startDate).getTime() / 1000));
      const cliffTs = new BN(Math.floor(new Date(cliffDate).getTime() / 1000));
      const endTs = new BN(Math.floor(new Date(endDate).getTime() / 1000));

      const result = await createVesting.mutateAsync({
        beneficiary: beneficiaryPk,
        mint: mintPk,
        seed: seedBn,
        totalAmount: amountBn,
        startTime: startTs,
        cliffTime: cliffTs,
        endTime: endTs,
      });

      setTxSig(result.tx);
    } catch (err: any) {
      const errorMsg =
        err?.error?.errorMessage ||
        err?.message ||
        "Transaction failed";
      setError(errorMsg);
    }
  };

  if (!publicKey) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-white">
            Connect Your Wallet
          </h2>
          <p className="text-zinc-400">
            Please connect your wallet to create a vesting schedule.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Create Vesting</h1>
        <p className="text-zinc-400 mt-2">
          Set up a new token vesting schedule for a beneficiary.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Beneficiary Address
            </label>
            <input
              type="text"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder="Solana public key..."
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Token Mint Address
            </label>
            <input
              type="text"
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              placeholder="SPL Token mint address..."
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Total Amount (tokens)
              </label>
              <input
                type="number"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="1000000"
                required
                min="0.000001"
                step="any"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Seed (unique ID)
              </label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                required
                min="0"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Start Date
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Cliff Date
              </label>
              <input
                type="datetime-local"
                value={cliffDate}
                onChange={(e) => setCliffDate(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                End Date
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={createVesting.isPending}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold rounded-lg transition-colors"
        >
          {createVesting.isPending ? "Creating..." : "Create Vesting Schedule"}
        </button>
      </form>

      {txSig && (
        <div className="bg-green-950/50 border border-green-800 rounded-lg p-4">
          <p className="text-green-400 text-sm font-medium">
            Vesting created successfully!
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
    </div>
  );
}
