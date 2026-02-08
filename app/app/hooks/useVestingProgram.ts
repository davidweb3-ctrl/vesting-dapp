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
      return accounts;
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
      return accounts;
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vestings"] });
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vestings"] });
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vestings"] });
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
