"use client";

import { PublicKey } from "@solana/web3.js";
import { calculateReleased } from "../lib/program";

interface VestingData {
  admin: PublicKey;
  beneficiary: PublicKey;
  mint: PublicKey;
  totalAmount: { toNumber: () => number };
  releasedAmount: { toNumber: () => number };
  startTime: { toNumber: () => number };
  cliffTime: { toNumber: () => number };
  endTime: { toNumber: () => number };
  seed: { toNumber: () => number };
  bump: number;
}

interface VestingCardProps {
  pubkey: PublicKey;
  account: VestingData;
  onDeposit?: () => void;
  onClaim?: () => void;
  isDepositing?: boolean;
  isClaiming?: boolean;
  role: "admin" | "beneficiary";
}

function formatAddress(pubkey: PublicKey): string {
  const str = pubkey.toString();
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function getStatus(
  account: VestingData,
  now: number
): { label: string; color: string } {
  const total = account.totalAmount.toNumber();
  const released = account.releasedAmount.toNumber();
  const cliff = account.cliffTime.toNumber();
  const end = account.endTime.toNumber();

  if (released >= total) return { label: "Fully Claimed", color: "text-green-400" };
  if (now < cliff) return { label: "Cliff Period", color: "text-yellow-400" };
  if (now >= end) return { label: "Fully Vested", color: "text-blue-400" };
  return { label: "Vesting", color: "text-indigo-400" };
}

export function VestingCard({
  pubkey,
  account,
  onDeposit,
  onClaim,
  isDepositing,
  isClaiming,
  role,
}: VestingCardProps) {
  const now = Math.floor(Date.now() / 1000);
  const total = account.totalAmount.toNumber();
  const released = account.releasedAmount.toNumber();
  const status = getStatus(account, now);

  const currentReleased = calculateReleased(
    total,
    account.startTime.toNumber(),
    account.cliffTime.toNumber(),
    account.endTime.toNumber(),
    now
  );
  const claimable = Math.max(0, currentReleased - released);
  const progress = total > 0 ? (currentReleased / total) * 100 : 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-zinc-400">
          {formatAddress(pubkey)}
        </h3>
        <span className={`text-sm font-medium ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="w-full bg-zinc-800 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500">
          <span>
            Released: {(currentReleased / 10 ** 6).toLocaleString()} /{" "}
            {(total / 10 ** 6).toLocaleString()}
          </span>
          <span>{progress.toFixed(1)}%</span>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-zinc-500">Beneficiary</p>
          <p className="text-zinc-200 font-mono text-xs">
            {formatAddress(account.beneficiary)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Mint</p>
          <p className="text-zinc-200 font-mono text-xs">
            {formatAddress(account.mint)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Cliff</p>
          <p className="text-zinc-200 text-xs">
            {formatTime(account.cliffTime.toNumber())}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">End</p>
          <p className="text-zinc-200 text-xs">
            {formatTime(account.endTime.toNumber())}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Claimed</p>
          <p className="text-zinc-200 text-xs">
            {(released / 10 ** 6).toLocaleString()} tokens
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Claimable Now</p>
          <p className="text-indigo-400 font-medium text-xs">
            {(claimable / 10 ** 6).toLocaleString()} tokens
          </p>
        </div>
      </div>

      {/* Action buttons */}
      {role === "admin" && onDeposit && (
        <button
          onClick={onDeposit}
          disabled={isDepositing}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {isDepositing ? "Depositing..." : "Deposit Tokens"}
        </button>
      )}
      {role === "beneficiary" && onClaim && claimable > 0 && (
        <button
          onClick={onClaim}
          disabled={isClaiming}
          className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {isClaiming
            ? "Claiming..."
            : `Claim ${(claimable / 10 ** 6).toLocaleString()} tokens`}
        </button>
      )}
    </div>
  );
}
