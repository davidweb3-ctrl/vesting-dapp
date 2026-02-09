"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  getMint,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram, getVestingPda, PROGRAM_ID } from "../lib/program";
import { AnchorVesting } from "../lib/program/types";

export function useAnchorProvider() {
  const { connection } = useConnection();
  const wallet = useWallet();

  return new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
}

export function useVestingProgram() {
  const provider = useAnchorProvider();
  const { connection } = useConnection();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  const program = getProgram(provider);

  // Fetch all vesting accounts for connected wallet (as admin)
  const adminVestings = useQuery({
    queryKey: ["vestings", "admin", wallet.publicKey?.toString()],
    queryFn: async () => {
      if (!wallet.publicKey) return [];
      const accounts = await program.account.vestingAccount.all([
        { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
      ]);
      
      // Fetch vault balances and mint decimals for each vesting
      const accountsWithVaultBalance = await Promise.all(
        accounts.map(async (acc) => {
          let decimals = 6; // default
          try {
            const mintInfo = await getMint(connection, acc.account.mint);
            decimals = mintInfo.decimals;
          } catch {}
          try {
            const vault = await getAssociatedTokenAddress(
              acc.account.mint,
              acc.publicKey,
              true
            );
            const vaultAccount = await getAccount(connection, vault);
            return {
              ...acc,
              vaultBalance: Number(vaultAccount.amount),
              isFunded: Number(vaultAccount.amount) > 0,
              decimals,
            };
          } catch (error) {
            // Vault doesn't exist or not funded
            return {
              ...acc,
              vaultBalance: 0,
              isFunded: false,
              decimals,
            };
          }
        })
      );
      
      return accountsWithVaultBalance;
    },
    enabled: !!wallet.publicKey,
  });

  // Fetch all vesting accounts for connected wallet (as beneficiary)
  const beneficiaryVestings = useQuery({
    queryKey: ["vestings", "beneficiary", wallet.publicKey?.toString()],
    queryFn: async () => {
      if (!wallet.publicKey) return [];
      const accounts = await program.account.vestingAccount.all([
        { memcmp: { offset: 8 + 32, bytes: wallet.publicKey.toBase58() } },
      ]);
      
      // Fetch vault balances and mint decimals for each vesting
      const accountsWithVaultBalance = await Promise.all(
        accounts.map(async (acc) => {
          let decimals = 6; // default
          try {
            const mintInfo = await getMint(connection, acc.account.mint);
            decimals = mintInfo.decimals;
          } catch {}
          try {
            const vault = await getAssociatedTokenAddress(
              acc.account.mint,
              acc.publicKey,
              true
            );
            const vaultAccount = await getAccount(connection, vault);
            return {
              ...acc,
              vaultBalance: Number(vaultAccount.amount),
              isFunded: Number(vaultAccount.amount) > 0,
              decimals,
            };
          } catch (error) {
            // Vault doesn't exist or not funded
            return {
              ...acc,
              vaultBalance: 0,
              isFunded: false,
              decimals,
            };
          }
        })
      );
      
      return accountsWithVaultBalance;
    },
    enabled: !!wallet.publicKey,
  });

  // Create vesting mutation
  const createVesting = useMutation({
    mutationFn: async ({
      beneficiary,
      mint,
      seed,
      totalAmount,
      startTime,
      cliffTime,
      endTime,
    }: {
      beneficiary: PublicKey;
      mint: PublicKey;
      seed: BN;
      totalAmount: BN;
      startTime: BN;
      cliffTime: BN;
      endTime: BN;
    }) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");

      const [vestingPda] = getVestingPda(beneficiary, mint, seed);
      const vault = await getAssociatedTokenAddress(mint, vestingPda, true);

      try {
        const tx = await program.methods
          .createVesting(seed, totalAmount, startTime, cliffTime, endTime)
          .accountsPartial({
            admin: wallet.publicKey,
            beneficiary,
            mint,
            vestingAccount: vestingPda,
            vault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();

        return { tx, vestingPda };
      } catch (error: any) {
        // Check if it's a user rejection - return null instead of throwing
        const errorMsg = error?.message || error?.toString() || "";
        if (
          errorMsg.includes("User rejected") ||
          errorMsg.includes("user rejected") ||
          errorMsg.includes("WalletSignTransactionError") ||
          error?.name === "WalletSignTransactionError"
        ) {
          // Return null to indicate user cancellation - this won't trigger error handlers
          return null as any;
        }
        // Re-throw other errors
        throw error;
      }
    },
    onSuccess: (data) => {
      // Only invalidate if transaction was successful (not null from user cancellation)
      if (data) {
        queryClient.invalidateQueries({ queryKey: ["vestings"] });
      }
    },
  });

  // Deposit mutation
  const deposit = useMutation({
    mutationFn: async ({
      vestingPda,
      mint,
    }: {
      vestingPda: PublicKey;
      mint: PublicKey;
    }) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");

      const vault = await getAssociatedTokenAddress(mint, vestingPda, true);
      const adminAta = await getAssociatedTokenAddress(
        mint,
        wallet.publicKey
      );

      try {
        const tx = await program.methods
          .deposit()
          .accountsPartial({
            admin: wallet.publicKey,
            mint,
            vestingAccount: vestingPda,
            vault,
            adminTokenAccount: adminAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();

        return tx;
      } catch (error: any) {
        // Check if it's a user rejection - return null instead of throwing
        const errorMsg = error?.message || error?.toString() || "";
        if (
          errorMsg.includes("User rejected") ||
          errorMsg.includes("user rejected") ||
          errorMsg.includes("WalletSignTransactionError") ||
          error?.name === "WalletSignTransactionError"
        ) {
          // Return null to indicate user cancellation - this won't trigger error handlers
          return null as any;
        }
        // Re-throw other errors
        throw error;
      }
    },
    onSuccess: (data) => {
      // Only invalidate if transaction was successful (not null from user cancellation)
      if (data) {
        queryClient.invalidateQueries({ queryKey: ["vestings"] });
      }
    },
  });

  // Claim mutation
  const claim = useMutation({
    mutationFn: async ({
      vestingPda,
      mint,
    }: {
      vestingPda: PublicKey;
      mint: PublicKey;
    }) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");

      const vault = await getAssociatedTokenAddress(mint, vestingPda, true);
      const beneficiaryAta = await getAssociatedTokenAddress(
        mint,
        wallet.publicKey
      );

      try {
        const tx = await program.methods
          .claim()
          .accountsPartial({
            beneficiary: wallet.publicKey,
            mint,
            vestingAccount: vestingPda,
            vault,
            beneficiaryTokenAccount: beneficiaryAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();

        return tx;
      } catch (error: any) {
        // Check if it's a user rejection - return null instead of throwing
        const errorMsg = error?.message || error?.toString() || "";
        if (
          errorMsg.includes("User rejected") ||
          errorMsg.includes("user rejected") ||
          errorMsg.includes("WalletSignTransactionError") ||
          error?.name === "WalletSignTransactionError"
        ) {
          // Return null to indicate user cancellation - this won't trigger error handlers
          return null as any;
        }
        // Re-throw other errors
        throw error;
      }
    },
    onSuccess: (data) => {
      // Only invalidate if transaction was successful (not null from user cancellation)
      if (data) {
        queryClient.invalidateQueries({ queryKey: ["vestings"] });
      }
    },
  });

  return {
    program,
    adminVestings,
    beneficiaryVestings,
    createVesting,
    deposit,
    claim,
  };
}
