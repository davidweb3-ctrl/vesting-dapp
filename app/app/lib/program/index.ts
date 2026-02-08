import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { AnchorVesting } from "./types";
import IDL from "./idl.json";
import BN from "bn.js";

export const PROGRAM_ID = new PublicKey(IDL.address);

export function getProgram(provider: AnchorProvider): Program<AnchorVesting> {
  return new Program(IDL as AnchorVesting, provider);
}

export function getVestingPda(
  beneficiary: PublicKey,
  mint: PublicKey,
  seed: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vesting"),
      beneficiary.toBuffer(),
      mint.toBuffer(),
      seed.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
}

export function calculateReleased(
  totalAmount: number,
  startTime: number,
  cliffTime: number,
  endTime: number,
  now: number
): number {
  if (now < cliffTime) return 0;
  if (now >= endTime) return totalAmount;

  const elapsed = now - startTime;
  const duration = endTime - startTime;
  return Math.floor((totalAmount * elapsed) / duration);
}
