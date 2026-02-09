"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { calculateReleased } from "../lib/program";
import { getTokenSymbol } from "../lib/utils/token-symbols";

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
  vaultBalance?: number;
  isFunded?: boolean;
}

interface VestingCardProps {
  pubkey: PublicKey;
  account: VestingData;
  decimals?: number;
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

function CopyableAddress({ pubkey, className }: { pubkey: PublicKey; className?: string }) {
  const [copied, setCopied] = useState(false);
  const full = pubkey.toString();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      title={full}
      className={`font-mono cursor-pointer hover:text-indigo-400 transition-colors inline-flex items-center gap-1 ${className ?? "text-zinc-200 text-xs"}`}
    >
      {copied ? (
        <>
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          {formatAddress(pubkey)}
          <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        </>
      )}
    </button>
  );
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
  decimals = 6,
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
  const divisor = 10 ** decimals;

  const currentReleased = calculateReleased(
    total,
    account.startTime.toNumber(),
    account.cliffTime.toNumber(),
    account.endTime.toNumber(),
    now
  );
  const claimable = Math.max(0, currentReleased - released);
  const progress = total > 0 ? (currentReleased / total) * 100 : 0;
  
  // Check if vault is funded (for claim functionality)
  const isFunded = account.isFunded ?? false;
  const vaultBalance = account.vaultBalance ?? 0;
  // Fully claimed: all tokens have been released, vault naturally empty
  const isFullyClaimed = released >= total && total > 0;
  // Token symbol for display
  const symbol = getTokenSymbol(account.mint.toString());

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <CopyableAddress pubkey={pubkey} className="text-zinc-400 text-sm" />
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
            Released: {(currentReleased / divisor).toLocaleString()} /{" "}
            {(total / divisor).toLocaleString()} {symbol}
          </span>
          <span>{progress.toFixed(1)}%</span>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-zinc-500">Beneficiary</p>
          <CopyableAddress pubkey={account.beneficiary} />
        </div>
        <div>
          <p className="text-zinc-500">Mint</p>
          <CopyableAddress pubkey={account.mint} />
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
            {(released / divisor).toLocaleString()} {symbol}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Claimable Now</p>
          <p className="text-indigo-400 font-medium text-xs">
            {(claimable / divisor).toLocaleString()} {symbol}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-zinc-500">Vault Status</p>
          <p className={`text-xs font-medium ${
            isFullyClaimed ? "text-green-400" : isFunded ? "text-green-400" : "text-red-400"
          }`}>
            {isFullyClaimed
              ? `Completed: All ${(total / divisor).toLocaleString()} ${symbol} claimed`
              : isFunded 
                ? `Funded: ${(vaultBalance / divisor).toLocaleString()} ${symbol}`
                : role === "beneficiary" 
                  ? "Not Funded - Admin must deposit first"
                  : "Not Funded - Click Deposit to fund"}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      {role === "admin" && (
        isFullyClaimed ? (
          <div className="w-full py-2.5 bg-green-950/50 border border-green-800 text-green-400 text-center font-medium rounded-lg text-sm">
            Vesting Completed
          </div>
        ) : onDeposit ? (
          <button
            onClick={onDeposit}
            disabled={isDepositing}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {isDepositing ? "Depositing..." : "Deposit Tokens"}
          </button>
        ) : isFunded ? (
          <div className="w-full py-2.5 bg-green-950/50 border border-green-800 text-green-400 text-center font-medium rounded-lg text-sm">
            Already Funded
          </div>
        ) : null
      )}
      {role === "beneficiary" && onClaim && (
        <>
          {isFullyClaimed ? (
            <div className="w-full py-2.5 bg-green-950/50 border border-green-800 text-green-400 text-center font-medium rounded-lg text-sm">
              All Tokens Claimed
            </div>
          ) : !isFunded ? (
            <div className="w-full py-2.5 bg-red-950/50 border border-red-800 text-red-400 text-center font-medium rounded-lg text-sm">
              Not Funded - Cannot Claim
            </div>
          ) : claimable > 0 ? (
            <button
              onClick={onClaim}
              disabled={isClaiming}
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors text-sm"
            >
              {isClaiming
                ? "Claiming..."
                : `Claim ${(claimable / divisor).toLocaleString()} ${symbol}`}
            </button>
          ) : (
            <div className="w-full py-2.5 bg-zinc-800 text-zinc-500 text-center font-medium rounded-lg text-sm">
              Nothing to Claim
            </div>
          )}
        </>
      )}
    </div>
  );
}
