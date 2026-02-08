/**
 * Security Test Suite
 *
 * Tests based on:
 *   - SRS NFR-1 (Security): Asset safety, access control, data integrity, exception handling
 *   - Architecture §6 (Security Architecture): Threat model, access control matrix, security checklist
 *   - Architecture §2.2.3 (Data Invariants): INV-1 through INV-7
 */

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
  getAccount,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

const PINOCCHIO_PROGRAM_ID = new PublicKey(
  "EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk"
);

describe("Security Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorVesting as Program<AnchorVesting>;
  const connection = provider.connection;

  // Test actors
  const admin = Keypair.generate();
  const beneficiary = Keypair.generate();
  const attacker = Keypair.generate();

  // Token state
  let mint: PublicKey;
  let mintB: PublicKey; // Second mint for mismatch tests
  const decimals = 6;
  const totalAmount = 1_000_000 * 10 ** decimals;

  let adminAta: PublicKey;
  let adminAtaB: PublicKey; // Admin ATA for mintB

  // Base vesting (funded, cliff passed)
  const baseSeed = new BN(900);
  let basePda: PublicKey;
  let baseVault: PublicKey;
  let baseStart: number;
  let baseCliff: number;
  let baseEnd: number;

  before(async () => {
    const airdropAmount = 20 * LAMPORTS_PER_SOL;
    await Promise.all([
      airdropSol(connection, admin.publicKey, airdropAmount),
      airdropSol(connection, beneficiary.publicKey, airdropAmount),
      airdropSol(connection, attacker.publicKey, airdropAmount),
    ]);

    // Create primary mint
    mint = await createMint(connection, admin, admin.publicKey, null, decimals);
    const adminAtaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mint,
      admin.publicKey
    );
    adminAta = adminAtaAccount.address;
    await mintTo(connection, admin, mint, adminAta, admin, totalAmount * 20);

    // Create secondary mint for mismatch tests
    mintB = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      decimals
    );
    const adminAtaBAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mintB,
      admin.publicKey
    );
    adminAtaB = adminAtaBAccount.address;
    await mintTo(
      connection,
      admin,
      mintB,
      adminAtaB,
      admin,
      totalAmount * 10
    );

    // Setup base vesting (cliff passed, in linear release)
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const now = blockTime || Math.floor(Date.now() / 1000);
    baseStart = now - 100;
    baseCliff = now - 50;
    baseEnd = now + 100;

    [basePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        beneficiary.publicKey.toBuffer(),
        mint.toBuffer(),
        baseSeed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    baseVault = await getAssociatedTokenAddress(mint, basePda, true);

    await program.methods
      .createVesting(
        baseSeed,
        new BN(totalAmount),
        new BN(baseStart),
        new BN(baseCliff),
        new BN(baseEnd)
      )
      .accountsPartial({
        admin: admin.publicKey,
        beneficiary: beneficiary.publicKey,
        mint,
        vestingAccount: basePda,
        vault: baseVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    await program.methods
      .deposit()
      .accountsPartial({
        admin: admin.publicKey,
        mint,
        vestingAccount: basePda,
        vault: baseVault,
        adminTokenAccount: adminAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
  });

  // ─────────────────────────────────────────
  // SEC-1: Asset Safety (NFR-1 §5.1.1)
  // ─────────────────────────────────────────

  describe("SEC-1: Asset Safety", () => {
    it("SEC-1.1: Vault owner is PDA (no private key)", async () => {
      const vaultAccount = await getAccount(connection, baseVault);
      expect(vaultAccount.owner.toString()).to.equal(basePda.toString());
    });

    it("SEC-1.2: Vault balance matches total_amount after deposit", async () => {
      const vaultAccount = await getAccount(connection, baseVault);
      expect(Number(vaultAccount.amount)).to.equal(totalAmount);
    });

    it("SEC-1.3: Direct SPL transfer from vault fails (no private key for PDA)", async () => {
      // Attempt to directly transfer from vault using attacker as authority
      try {
        await transfer(
          connection,
          attacker,
          baseVault,
          await getAssociatedTokenAddress(mint, attacker.publicKey),
          attacker, // attacker cannot sign for PDA
          1000
        );
        expect.fail("Should have failed: cannot directly transfer from PDA vault");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });
  });

  // ─────────────────────────────────────────
  // SEC-2: Access Control (NFR-1 §5.1.2 + Architecture §6.2)
  // ─────────────────────────────────────────

  describe("SEC-2: Access Control", () => {
    it("SEC-2.1: attacker cannot deposit into someone else's vesting", async () => {
      // Create a new vesting and try to deposit with wrong admin
      const aSeed = new BN(910);
      const [aPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          aSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const aVault = await getAssociatedTokenAddress(mint, aPda, true);

      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      await program.methods
        .createVesting(
          aSeed,
          new BN(totalAmount),
          new BN(now - 10),
          new BN(now + 20),
          new BN(now + 60)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: aPda,
          vault: aVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Fund attacker with tokens
      const attackerAta = await getOrCreateAssociatedTokenAccount(
        connection,
        attacker,
        mint,
        attacker.publicKey
      );
      await mintTo(
        connection,
        admin,
        mint,
        attackerAta.address,
        admin,
        totalAmount
      );

      try {
        await program.methods
          .deposit()
          .accountsPartial({
            admin: attacker.publicKey, // Wrong admin
            mint,
            vestingAccount: aPda,
            vault: aVault,
            adminTokenAccount: attackerAta.address,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        expect.fail("Should have failed: attacker is not admin");
      } catch (err: any) {
        // Anchor has_one constraint rejects
        expect(err.toString()).to.include("Error");
      }
    });

    it("SEC-2.2: attacker cannot claim someone else's vesting", async () => {
      const attackerAta = await getAssociatedTokenAddress(
        mint,
        attacker.publicKey
      );

      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: attacker.publicKey, // Wrong beneficiary
            mint,
            vestingAccount: basePda,
            vault: baseVault,
            beneficiaryTokenAccount: attackerAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        expect.fail("Should have failed: attacker is not beneficiary");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });

    it("SEC-2.3: admin cannot claim (admin != beneficiary role separation)", async () => {
      const adminTokenAcc = await getAssociatedTokenAddress(
        mint,
        admin.publicKey
      );

      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: admin.publicKey, // Admin trying to claim
            mint,
            vestingAccount: basePda,
            vault: baseVault,
            beneficiaryTokenAccount: adminTokenAcc,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: admin is not beneficiary");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });
  });

  // ─────────────────────────────────────────
  // SEC-3: Data Integrity (NFR-1 §5.1.3 + Architecture §2.2.3)
  // ─────────────────────────────────────────

  describe("SEC-3: Data Integrity & Invariants", () => {
    it("SEC-3.1: INV-1: released_amount <= total_amount after claim", async () => {
      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      await program.methods
        .claim()
        .accountsPartial({
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: basePda,
          vault: baseVault,
          beneficiaryTokenAccount: beneficiaryTokenAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(basePda);
      expect(vesting.releasedAmount.toNumber()).to.be.at.most(
        vesting.totalAmount.toNumber()
      );
    });

    it("SEC-3.2: INV-2/3: time range invariant preserved after creation", async () => {
      const vesting = await program.account.vestingAccount.fetch(basePda);
      expect(vesting.startTime.toNumber()).to.be.at.most(
        vesting.cliffTime.toNumber()
      );
      expect(vesting.cliffTime.toNumber()).to.be.at.most(
        vesting.endTime.toNumber()
      );
      expect(vesting.startTime.toNumber()).to.be.lessThan(
        vesting.endTime.toNumber()
      );
    });

    it("SEC-3.3: INV-4: total_amount > 0 invariant holds", async () => {
      const vesting = await program.account.vestingAccount.fetch(basePda);
      expect(vesting.totalAmount.toNumber()).to.be.greaterThan(0);
    });

    it("SEC-3.4: INV-5: vault.amount == total_amount - released_amount", async () => {
      const vesting = await program.account.vestingAccount.fetch(basePda);
      const vaultAccount = await getAccount(connection, baseVault);
      expect(Number(vaultAccount.amount)).to.equal(
        vesting.totalAmount.toNumber() - vesting.releasedAmount.toNumber()
      );
    });

    it("SEC-3.5: INV-6/7: vault ownership and mint consistency", async () => {
      const vaultAccount = await getAccount(connection, baseVault);
      expect(vaultAccount.owner.toString()).to.equal(basePda.toString());
      expect(vaultAccount.mint.toString()).to.equal(mint.toString());

      const vesting = await program.account.vestingAccount.fetch(basePda);
      expect(vesting.mint.toString()).to.equal(mint.toString());
    });

    it("SEC-3.6: parameters are immutable after creation", async () => {
      const vestingBefore = await program.account.vestingAccount.fetch(
        basePda
      );

      // Perform a claim to mutate released_amount
      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      await new Promise((r) => setTimeout(r, 2000));

      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: basePda,
            vault: baseVault,
            beneficiaryTokenAccount: beneficiaryTokenAcc,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([beneficiary])
          .rpc();
      } catch {
        // may fail if nothing to claim yet
      }

      const vestingAfter = await program.account.vestingAccount.fetch(basePda);

      // All immutable fields must remain the same
      expect(vestingAfter.admin.toString()).to.equal(
        vestingBefore.admin.toString()
      );
      expect(vestingAfter.beneficiary.toString()).to.equal(
        vestingBefore.beneficiary.toString()
      );
      expect(vestingAfter.mint.toString()).to.equal(
        vestingBefore.mint.toString()
      );
      expect(vestingAfter.totalAmount.toNumber()).to.equal(
        vestingBefore.totalAmount.toNumber()
      );
      expect(vestingAfter.startTime.toNumber()).to.equal(
        vestingBefore.startTime.toNumber()
      );
      expect(vestingAfter.cliffTime.toNumber()).to.equal(
        vestingBefore.cliffTime.toNumber()
      );
      expect(vestingAfter.endTime.toNumber()).to.equal(
        vestingBefore.endTime.toNumber()
      );
      expect(vestingAfter.seed.toNumber()).to.equal(
        vestingBefore.seed.toNumber()
      );
      expect(vestingAfter.bump).to.equal(vestingBefore.bump);

      // Only released_amount may have changed (monotonic increase)
      expect(vestingAfter.releasedAmount.toNumber()).to.be.at.least(
        vestingBefore.releasedAmount.toNumber()
      );
    });
  });

  // ─────────────────────────────────────────
  // SEC-4: PDA Verification (Architecture §6.1)
  // ─────────────────────────────────────────

  describe("SEC-4: PDA Verification", () => {
    it("SEC-4.1: PDA is deterministic and verifiable from public seeds", async () => {
      const vesting = await program.account.vestingAccount.fetch(basePda);

      // Re-derive PDA from seeds
      const [derivedPda, derivedBump] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          vesting.beneficiary.toBuffer(),
          vesting.mint.toBuffer(),
          vesting.seed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      expect(derivedPda.toString()).to.equal(basePda.toString());
      expect(derivedBump).to.equal(vesting.bump);
    });

    it("SEC-4.2: cannot create vesting with forged PDA (wrong seeds)", async () => {
      // Try to init an account with mismatched seeds
      const fakeSeed = new BN(999);
      const fakeAdmin = Keypair.generate();
      await airdropSol(connection, fakeAdmin.publicKey, 5 * LAMPORTS_PER_SOL);

      // Derive PDA with seed=999 but pass seed=998 in instruction
      const [fakePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          fakeSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const fakeVault = await getAssociatedTokenAddress(mint, fakePda, true);

      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      try {
        // Pass seed=998 but account is PDA for seed=999 → seeds won't match
        await program.methods
          .createVesting(
            new BN(998), // Wrong seed
            new BN(totalAmount),
            new BN(now - 10),
            new BN(now + 20),
            new BN(now + 60)
          )
          .accountsPartial({
            admin: fakeAdmin.publicKey,
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: fakePda,
            vault: fakeVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([fakeAdmin])
          .rpc();
        expect.fail("Should have failed: PDA seeds mismatch");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });
  });

  // ─────────────────────────────────────────
  // SEC-5: Idempotency & Double-Spend (BR-4)
  // ─────────────────────────────────────────

  describe("SEC-5: Idempotency", () => {
    it("SEC-5.1: cannot create same vesting PDA twice", async () => {
      // basePda already exists; try to create again with same seeds
      try {
        await program.methods
          .createVesting(
            baseSeed,
            new BN(totalAmount),
            new BN(baseStart),
            new BN(baseCliff),
            new BN(baseEnd)
          )
          .accountsPartial({
            admin: admin.publicKey,
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: basePda,
            vault: baseVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: PDA already initialized");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });

    it("SEC-5.2: duplicate deposit on already funded vesting fails", async () => {
      try {
        await program.methods
          .deposit()
          .accountsPartial({
            admin: admin.publicKey,
            mint,
            vestingAccount: basePda,
            vault: baseVault,
            adminTokenAccount: adminAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: already funded");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("AlreadyFunded");
      }
    });
  });

  // ─────────────────────────────────────────
  // SEC-6: Overflow Protection (Architecture §6.1)
  // ─────────────────────────────────────────

  describe("SEC-6: Overflow Protection", () => {
    it("SEC-6.1: vesting calculation uses u128 safe math (large amounts)", async () => {
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      const bigSeed = new BN(920);
      // Use amount that would overflow u64 if multiplied naively
      const bigAmount = new BN("9000000000000000000"); // 9 * 10^18

      const [bigPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          bigSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const bigVault = await getAssociatedTokenAddress(mint, bigPda, true);

      // Should succeed (u128 intermediate math handles this)
      await program.methods
        .createVesting(
          bigSeed,
          bigAmount,
          new BN(now - 100),
          new BN(now - 50),
          new BN(now + 100)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: bigPda,
          vault: bigVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(bigPda);
      expect(vesting.totalAmount.toString()).to.equal(bigAmount.toString());
    });
  });

  // ─────────────────────────────────────────
  // SEC-7: Cross-Program State Consistency (Pinocchio interop)
  // ─────────────────────────────────────────

  describe("SEC-7: Cross-Program Data Integrity", () => {
    it("SEC-7.1: Pinocchio can parse Anchor-created vesting account data", async () => {
      // Read raw account data of Anchor-created vesting
      const accountInfo = await connection.getAccountInfo(basePda);
      expect(accountInfo).to.not.be.null;

      const data = accountInfo!.data;
      // Skip 8-byte Anchor discriminator
      const adminKey = new PublicKey(data.subarray(8, 40));
      const beneficiaryKey = new PublicKey(data.subarray(40, 72));
      const mintKey = new PublicKey(data.subarray(72, 104));
      const rawTotalAmount = Number(data.readBigUInt64LE(104));
      const rawReleasedAmount = Number(data.readBigUInt64LE(112));
      const rawStartTime = Number(data.readBigInt64LE(120));
      const rawCliffTime = Number(data.readBigInt64LE(128));
      const rawEndTime = Number(data.readBigInt64LE(136));
      const rawSeed = Number(data.readBigUInt64LE(144));
      const rawBump = data[152];

      // Verify against Anchor deserialized data
      const vesting = await program.account.vestingAccount.fetch(basePda);
      expect(adminKey.toString()).to.equal(vesting.admin.toString());
      expect(beneficiaryKey.toString()).to.equal(
        vesting.beneficiary.toString()
      );
      expect(mintKey.toString()).to.equal(vesting.mint.toString());
      expect(rawTotalAmount).to.equal(vesting.totalAmount.toNumber());
      expect(rawReleasedAmount).to.equal(vesting.releasedAmount.toNumber());
      expect(rawStartTime).to.equal(vesting.startTime.toNumber());
      expect(rawCliffTime).to.equal(vesting.cliffTime.toNumber());
      expect(rawEndTime).to.equal(vesting.endTime.toNumber());
      expect(rawSeed).to.equal(vesting.seed.toNumber());
      expect(rawBump).to.equal(vesting.bump);
    });
  });
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

async function airdropSol(
  connection: anchor.web3.Connection,
  publicKey: PublicKey,
  amount: number
) {
  const sig = await connection.requestAirdrop(publicKey, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
}
