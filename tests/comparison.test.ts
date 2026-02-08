import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorVesting } from "../target/types/anchor_vesting";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

const PINOCCHIO_PROGRAM_ID = new PublicKey(
  "EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk"
);

describe("CU Comparison: Anchor vs Pinocchio", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorVesting as Program<AnchorVesting>;
  const connection = provider.connection;

  const admin = Keypair.generate();
  const beneficiary = Keypair.generate();
  let mint: PublicKey;
  const decimals = 6;
  const totalAmount = 1_000_000 * 10 ** decimals;

  // Anchor-derived accounts
  const anchorSeed = new BN(50);
  let anchorPda: PublicKey;
  let anchorBump: number;
  let anchorVault: PublicKey;

  // Pinocchio-derived accounts
  const pinocchioSeed = new BN(50);
  let pinocchioPda: PublicKey;
  let pinocchioBump: number;
  let pinocchioVault: PublicKey;

  let adminAta: PublicKey;
  let startTime: number;
  let cliffTime: number;
  let endTime: number;

  before(async () => {
    const airdropAmount = 20 * LAMPORTS_PER_SOL;
    await Promise.all([
      airdropSol(connection, admin.publicKey, airdropAmount),
      airdropSol(connection, beneficiary.publicKey, airdropAmount),
    ]);

    mint = await createMint(connection, admin, admin.publicKey, null, decimals);

    const adminAtaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mint,
      admin.publicKey
    );
    adminAta = adminAtaAccount.address;
    await mintTo(connection, admin, mint, adminAta, admin, totalAmount * 10);

    [anchorPda, anchorBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        beneficiary.publicKey.toBuffer(),
        mint.toBuffer(),
        anchorSeed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    anchorVault = await getAssociatedTokenAddress(mint, anchorPda, true);

    [pinocchioPda, pinocchioBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        beneficiary.publicKey.toBuffer(),
        mint.toBuffer(),
        pinocchioSeed.toArrayLike(Buffer, "le", 8),
      ],
      PINOCCHIO_PROGRAM_ID
    );
    pinocchioVault = await getAssociatedTokenAddress(mint, pinocchioPda, true);

    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const now = blockTime || Math.floor(Date.now() / 1000);
    startTime = now - 10;
    cliffTime = now - 5; // cliff already passed for comparison test
    endTime = now + 600; // far in the future
  });

  it("compares create_vesting CU consumption", async () => {
    // --- Anchor ---
    const anchorTx = await program.methods
      .createVesting(
        anchorSeed,
        new BN(totalAmount),
        new BN(startTime),
        new BN(cliffTime),
        new BN(endTime)
      )
      .accountsPartial({
        admin: admin.publicKey,
        beneficiary: beneficiary.publicKey,
        mint,
        vestingAccount: anchorPda,
        vault: anchorVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const anchorCU = await getComputeUnits(connection, anchorTx);

    // --- Pinocchio ---
    const pinData = Buffer.alloc(42);
    pinData[0] = 0;
    pinData.writeBigUInt64LE(BigInt(pinocchioSeed.toString()), 1);
    pinData.writeBigUInt64LE(BigInt(totalAmount.toString()), 9);
    pinData.writeBigInt64LE(BigInt(startTime.toString()), 17);
    pinData.writeBigInt64LE(BigInt(cliffTime.toString()), 25);
    pinData.writeBigInt64LE(BigInt(endTime.toString()), 33);
    pinData[41] = pinocchioBump;

    const pinIx = new TransactionInstruction({
      programId: PINOCCHIO_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: beneficiary.publicKey, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: pinocchioPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: pinData,
    });

    const pinTxSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(pinIx),
      [admin]
    );

    const pinocchioCU = await getComputeUnits(connection, pinTxSig);

    console.log("\n  === Create Vesting CU Comparison ===");
    console.log(`    Anchor:    ${anchorCU} CU`);
    console.log(`    Pinocchio: ${pinocchioCU} CU`);
    if (anchorCU && pinocchioCU) {
      const savings = ((anchorCU - pinocchioCU) / anchorCU) * 100;
      console.log(`    Savings:   ${savings.toFixed(1)}%\n`);
    }

    expect(anchorCU).to.be.greaterThan(0);
    expect(pinocchioCU).to.be.greaterThan(0);
  });

  it("compares deposit CU consumption", async () => {
    // Create vault ATA for pinocchio (allowOwnerOffCurve = true for PDA)
    await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mint,
      pinocchioPda,
      true // allowOwnerOffCurve
    );

    // --- Anchor deposit ---
    const anchorTx = await program.methods
      .deposit()
      .accountsPartial({
        admin: admin.publicKey,
        mint,
        vestingAccount: anchorPda,
        vault: anchorVault,
        adminTokenAccount: adminAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const anchorCU = await getComputeUnits(connection, anchorTx);

    // --- Pinocchio deposit ---
    const pinIx = new TransactionInstruction({
      programId: PINOCCHIO_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: pinocchioPda, isSigner: false, isWritable: false },
        { pubkey: pinocchioVault, isSigner: false, isWritable: true },
        { pubkey: adminAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    });

    const pinTxSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(pinIx),
      [admin]
    );

    const pinocchioCU = await getComputeUnits(connection, pinTxSig);

    console.log("\n  === Deposit CU Comparison ===");
    console.log(`    Anchor:    ${anchorCU} CU`);
    console.log(`    Pinocchio: ${pinocchioCU} CU`);
    if (anchorCU && pinocchioCU) {
      const savings = ((anchorCU - pinocchioCU) / anchorCU) * 100;
      console.log(`    Savings:   ${savings.toFixed(1)}%\n`);
    }

    expect(anchorCU).to.be.greaterThan(0);
    expect(pinocchioCU).to.be.greaterThan(0);
  });

  it("verifies both programs produce equivalent state", async () => {
    // Read Anchor vesting state
    const anchorVesting = await program.account.vestingAccount.fetch(anchorPda);

    // Read Pinocchio vesting state (raw bytes)
    const pinAccount = await connection.getAccountInfo(pinocchioPda);
    expect(pinAccount).to.not.be.null;
    const pinData = pinAccount!.data;

    const pinAdmin = new PublicKey(pinData.subarray(0, 32));
    const pinBeneficiary = new PublicKey(pinData.subarray(32, 64));
    const pinMint = new PublicKey(pinData.subarray(64, 96));
    const pinTotalAmount = Number(pinData.readBigUInt64LE(96));
    const pinReleasedAmount = Number(pinData.readBigUInt64LE(104));

    // Both should have same logical state
    expect(anchorVesting.admin.toString()).to.equal(pinAdmin.toString());
    expect(anchorVesting.beneficiary.toString()).to.equal(pinBeneficiary.toString());
    expect(anchorVesting.mint.toString()).to.equal(pinMint.toString());
    expect(anchorVesting.totalAmount.toNumber()).to.equal(pinTotalAmount);
    expect(anchorVesting.releasedAmount.toNumber()).to.equal(pinReleasedAmount);
    // Time params should be the same since we used the same inputs
    expect(anchorVesting.startTime.toNumber()).to.equal(
      Number(pinData.readBigInt64LE(112))
    );
    expect(anchorVesting.endTime.toNumber()).to.equal(
      Number(pinData.readBigInt64LE(128))
    );
  });
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function getComputeUnits(
  connection: anchor.web3.Connection,
  txSig: string
): Promise<number> {
  // Poll until transaction is fully indexed
  for (let i = 0; i < 10; i++) {
    const tx = await connection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx && tx.meta && tx.meta.computeUnitsConsumed !== undefined) {
      return tx.meta.computeUnitsConsumed;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return 0;
}

async function airdropSol(
  connection: anchor.web3.Connection,
  publicKey: PublicKey,
  amount: number
) {
  const sig = await connection.requestAirdrop(publicKey, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
}
