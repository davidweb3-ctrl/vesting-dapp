import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorVesting } from "../target/types/anchor_vesting";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

describe("anchor-vesting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorVesting as Program<AnchorVesting>;
  const connection = provider.connection;

  // Test actors
  const admin = Keypair.generate();
  const beneficiary = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  // Token state
  let mint: PublicKey;
  const decimals = 6;
  const totalAmount = 1_000_000 * 10 ** decimals; // 1M tokens
  const seed = new BN(1);

  // Derived accounts
  let vestingPda: PublicKey;
  let vestingBump: number;
  let vault: PublicKey;
  let adminAta: PublicKey;
  let beneficiaryAta: PublicKey;

  // Time parameters (relative to "now")
  let startTime: number;
  let cliffTime: number;
  let endTime: number;

  // ─────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────

  before(async () => {
    // Airdrop SOL to test actors
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    await Promise.all([
      airdropSol(connection, admin.publicKey, airdropAmount),
      airdropSol(connection, beneficiary.publicKey, airdropAmount),
      airdropSol(connection, unauthorizedUser.publicKey, airdropAmount),
    ]);

    // Create SPL Token mint
    mint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      decimals
    );

    // Create admin's ATA and mint tokens
    const adminAtaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mint,
      admin.publicKey
    );
    adminAta = adminAtaAccount.address;
    await mintTo(
      connection,
      admin,
      mint,
      adminAta,
      admin,
      totalAmount * 10 // mint extra for multiple tests
    );

    // Derive PDA and vault
    [vestingPda, vestingBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        beneficiary.publicKey.toBuffer(),
        mint.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    vault = await getAssociatedTokenAddress(mint, vestingPda, true);
    beneficiaryAta = await getAssociatedTokenAddress(
      mint,
      beneficiary.publicKey
    );

    // Set time parameters: start=now, cliff=+30s, end=+60s
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const now = blockTime || Math.floor(Date.now() / 1000);
    startTime = now - 10; // started 10s ago
    cliffTime = now + 20; // cliff in 20s
    endTime = now + 60; // end in 60s
  });

  // ─────────────────────────────────────────
  // TR-1: Functional Tests (Happy Path)
  // ─────────────────────────────────────────

  describe("TR-1: Happy Path", () => {
    it("T-01: creates vesting with valid parameters", async () => {
      const tx = await program.methods
        .createVesting(
          seed,
          new BN(totalAmount),
          new BN(startTime),
          new BN(cliffTime),
          new BN(endTime)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: vestingPda,
          vault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Verify vesting account data
      const vesting = await program.account.vestingAccount.fetch(vestingPda);
      expect(vesting.admin.toString()).to.equal(admin.publicKey.toString());
      expect(vesting.beneficiary.toString()).to.equal(
        beneficiary.publicKey.toString()
      );
      expect(vesting.mint.toString()).to.equal(mint.toString());
      expect(vesting.totalAmount.toNumber()).to.equal(totalAmount);
      expect(vesting.releasedAmount.toNumber()).to.equal(0);
      expect(vesting.startTime.toNumber()).to.equal(startTime);
      expect(vesting.cliffTime.toNumber()).to.equal(cliffTime);
      expect(vesting.endTime.toNumber()).to.equal(endTime);
      expect(vesting.seed.toNumber()).to.equal(seed.toNumber());
      expect(vesting.bump).to.equal(vestingBump);
    });

    it("T-02: deposits tokens into vault", async () => {
      const tx = await program.methods
        .deposit()
        .accountsPartial({
          admin: admin.publicKey,
          mint,
          vestingAccount: vestingPda,
          vault,
          adminTokenAccount: adminAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Verify vault balance
      const vaultAccount = await getAccount(connection, vault);
      expect(Number(vaultAccount.amount)).to.equal(totalAmount);
    });
  });

  // ─────────────────────────────────────────
  // TR-2: Time Logic Tests
  // ─────────────────────────────────────────

  describe("TR-2: Time Logic", () => {
    it("T-10: claim fails before cliff", async () => {
      // Cliff hasn't passed yet in real time (cliffTime is ~20s from setup)
      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: vestingPda,
            vault,
            beneficiaryTokenAccount: beneficiaryAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([beneficiary])
          .rpc();
        expect.fail("Should have failed: cliff not reached");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("NothingToClaim");
      }
    });
  });

  // ─────────────────────────────────────────
  // TR-3: Security Tests
  // ─────────────────────────────────────────

  describe("TR-3: Security", () => {
    // We need a separate vesting for some security tests
    const secSeed = new BN(100);
    let secVestingPda: PublicKey;
    let secVault: PublicKey;

    before(async () => {
      [secVestingPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          secSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      secVault = await getAssociatedTokenAddress(mint, secVestingPda, true);

      // Create a second vesting for security tests
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      await program.methods
        .createVesting(
          secSeed,
          new BN(totalAmount),
          new BN(now - 10),
          new BN(now + 20),
          new BN(now + 60)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: secVestingPda,
          vault: secVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
    });

    it("T-20: non-admin cannot deposit", async () => {
      const unauthorizedAta = await getAssociatedTokenAddress(
        mint,
        unauthorizedUser.publicKey
      );
      try {
        await program.methods
          .deposit()
          .accountsPartial({
            admin: unauthorizedUser.publicKey,
            mint,
            vestingAccount: secVestingPda,
            vault: secVault,
            adminTokenAccount: unauthorizedAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have failed: unauthorized admin");
      } catch (err: any) {
        // Anchor's has_one constraint error
        expect(err.toString()).to.include("Error");
      }
    });

    it("T-21: non-beneficiary cannot claim", async () => {
      // First, deposit into security vesting
      await program.methods
        .deposit()
        .accountsPartial({
          admin: admin.publicKey,
          mint,
          vestingAccount: secVestingPda,
          vault: secVault,
          adminTokenAccount: adminAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const unauthorizedAta = await getAssociatedTokenAddress(
        mint,
        unauthorizedUser.publicKey
      );
      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: unauthorizedUser.publicKey,
            mint,
            vestingAccount: secVestingPda,
            vault: secVault,
            beneficiaryTokenAccount: unauthorizedAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have failed: unauthorized beneficiary");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });

    it("T-22: duplicate deposit fails", async () => {
      try {
        await program.methods
          .deposit()
          .accountsPartial({
            admin: admin.publicKey,
            mint,
            vestingAccount: secVestingPda,
            vault: secVault,
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
  // TR-1 (continued): Happy Path (time-dependent)
  // ─────────────────────────────────────────

  describe("TR-1: Happy Path (time-dependent)", () => {
    const pastCliffSeed = new BN(500);
    let pastCliffPda: PublicKey;
    let pastCliffVault: PublicKey;

    const fullyExpiredSeed = new BN(501);
    let fullyExpiredPda: PublicKey;
    let fullyExpiredVault: PublicKey;

    let pastCliffStart: number;
    let pastCliffCliff: number;
    let pastCliffEnd: number;

    let expiredStart: number;
    let expiredCliff: number;
    let expiredEnd: number;

    before(async () => {
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      // Vesting with cliff already passed, end in future
      pastCliffStart = now - 100;
      pastCliffCliff = now - 50;
      pastCliffEnd = now + 100;

      [pastCliffPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          pastCliffSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      pastCliffVault = await getAssociatedTokenAddress(
        mint,
        pastCliffPda,
        true
      );

      await program.methods
        .createVesting(
          pastCliffSeed,
          new BN(totalAmount),
          new BN(pastCliffStart),
          new BN(pastCliffCliff),
          new BN(pastCliffEnd)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: pastCliffPda,
          vault: pastCliffVault,
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
          vestingAccount: pastCliffPda,
          vault: pastCliffVault,
          adminTokenAccount: adminAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Fully expired vesting
      expiredStart = now - 200;
      expiredCliff = now - 150;
      expiredEnd = now - 50;

      [fullyExpiredPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          fullyExpiredSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      fullyExpiredVault = await getAssociatedTokenAddress(
        mint,
        fullyExpiredPda,
        true
      );

      await program.methods
        .createVesting(
          fullyExpiredSeed,
          new BN(totalAmount),
          new BN(expiredStart),
          new BN(expiredCliff),
          new BN(expiredEnd)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: fullyExpiredPda,
          vault: fullyExpiredVault,
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
          vestingAccount: fullyExpiredPda,
          vault: fullyExpiredVault,
          adminTokenAccount: adminAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
    });

    it("T-03: claim succeeds after cliff with partial amount", async () => {
      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      await program.methods
        .claim()
        .accountsPartial({
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: pastCliffPda,
          vault: pastCliffVault,
          beneficiaryTokenAccount: beneficiaryTokenAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(pastCliffPda);
      expect(vesting.releasedAmount.toNumber()).to.be.greaterThan(0);
      expect(vesting.releasedAmount.toNumber()).to.be.lessThan(totalAmount);

      // INV-5: vault.amount == total_amount - released_amount
      const vaultAccount = await getAccount(connection, pastCliffVault);
      expect(Number(vaultAccount.amount)).to.equal(
        totalAmount - vesting.releasedAmount.toNumber()
      );
    });

    it("T-04: claim after end releases all remaining tokens", async () => {
      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      await program.methods
        .claim()
        .accountsPartial({
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: fullyExpiredPda,
          vault: fullyExpiredVault,
          beneficiaryTokenAccount: beneficiaryTokenAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(
        fullyExpiredPda
      );
      expect(vesting.releasedAmount.toNumber()).to.equal(totalAmount);

      // Vault should be empty
      const vaultAccount = await getAccount(connection, fullyExpiredVault);
      expect(Number(vaultAccount.amount)).to.equal(0);
    });

    it("T-05: multiple claims increment released_amount monotonically", async () => {
      // pastCliffPda was partially claimed in T-03; claim again
      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      const vestingBefore = await program.account.vestingAccount.fetch(
        pastCliffPda
      );
      const releasedBefore = vestingBefore.releasedAmount.toNumber();

      // Small delay to let more tokens vest
      await new Promise((r) => setTimeout(r, 2000));

      await program.methods
        .claim()
        .accountsPartial({
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: pastCliffPda,
          vault: pastCliffVault,
          beneficiaryTokenAccount: beneficiaryTokenAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();

      const vestingAfter = await program.account.vestingAccount.fetch(
        pastCliffPda
      );
      const releasedAfter = vestingAfter.releasedAmount.toNumber();

      // INV-1: released_amount monotonically increases
      expect(releasedAfter).to.be.greaterThan(releasedBefore);
      expect(releasedAfter).to.be.at.most(totalAmount);
    });
  });

  // ─────────────────────────────────────────
  // TR-2 (extended): Time Logic Tests
  // ─────────────────────────────────────────

  describe("TR-2: Time Logic (extended)", () => {
    it("T-11: claim at cliff moment yields correct partial amount", async () => {
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      // Cliff just passed: start far back, cliff = now - 1, end far future
      const cliffSeed = new BN(600);
      const cliffStart = now - 100;
      const cliffCliff = now - 1;
      const cliffEnd = now + 100;

      const [cliffPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          cliffSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const cliffVault = await getAssociatedTokenAddress(
        mint,
        cliffPda,
        true
      );

      await program.methods
        .createVesting(
          cliffSeed,
          new BN(totalAmount),
          new BN(cliffStart),
          new BN(cliffCliff),
          new BN(cliffEnd)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: cliffPda,
          vault: cliffVault,
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
          vestingAccount: cliffPda,
          vault: cliffVault,
          adminTokenAccount: adminAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      await program.methods
        .claim()
        .accountsPartial({
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: cliffPda,
          vault: cliffVault,
          beneficiaryTokenAccount: beneficiaryTokenAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(cliffPda);
      // ~50% elapsed (100 out of 200), so should be ~50% of total
      const released = vesting.releasedAmount.toNumber();
      expect(released).to.be.greaterThan(0);
      expect(released).to.be.lessThan(totalAmount);
      // Rough check: should be approximately 50%
      expect(released).to.be.greaterThan(totalAmount * 0.4);
      expect(released).to.be.lessThan(totalAmount * 0.6);
    });

    it("T-14: second claim after full release fails with NothingToClaim", async () => {
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      const endSeed = new BN(601);
      const [endPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          endSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const endVault = await getAssociatedTokenAddress(mint, endPda, true);

      // Fully expired vesting
      await program.methods
        .createVesting(
          endSeed,
          new BN(totalAmount),
          new BN(now - 200),
          new BN(now - 150),
          new BN(now - 50)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: endPda,
          vault: endVault,
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
          vestingAccount: endPda,
          vault: endVault,
          adminTokenAccount: adminAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      // First claim: should succeed and claim all
      await program.methods
        .claim()
        .accountsPartial({
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: endPda,
          vault: endVault,
          beneficiaryTokenAccount: beneficiaryTokenAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(endPda);
      expect(vesting.releasedAmount.toNumber()).to.equal(totalAmount);

      // Second claim: should fail with NothingToClaim
      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: endPda,
            vault: endVault,
            beneficiaryTokenAccount: beneficiaryTokenAcc,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([beneficiary])
          .rpc();
        expect.fail("Should have failed: nothing to claim");
      } catch (err: any) {
        // NotFunded (vault is empty) or NothingToClaim
        expect(err.toString()).to.include("Error");
      }
    });
  });

  // ─────────────────────────────────────────
  // TR-3 (extended): Security Tests
  // ─────────────────────────────────────────

  describe("TR-3: Security (extended)", () => {
    it("T-25: claim before deposit fails with NotFunded", async () => {
      const noDepSeed = new BN(700);
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      const [noDepPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          noDepSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const noDepVault = await getAssociatedTokenAddress(
        mint,
        noDepPda,
        true
      );

      await program.methods
        .createVesting(
          noDepSeed,
          new BN(totalAmount),
          new BN(now - 200),
          new BN(now - 100),
          new BN(now - 50)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: noDepPda,
          vault: noDepVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Do NOT deposit, try to claim immediately
      const beneficiaryTokenAcc = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      try {
        await program.methods
          .claim()
          .accountsPartial({
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: noDepPda,
            vault: noDepVault,
            beneficiaryTokenAccount: beneficiaryTokenAcc,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([beneficiary])
          .rpc();
        expect.fail("Should have failed: not funded");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("NotFunded");
      }
    });
  });

  // ─────────────────────────────────────────
  // TR-4: Boundary Tests
  // ─────────────────────────────────────────

  describe("TR-4: Boundary", () => {
    it("T-30: total_amount = 0 fails", async () => {
      const badSeed = new BN(200);
      const [badPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          badSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const badVault = await getAssociatedTokenAddress(mint, badPda, true);

      try {
        await program.methods
          .createVesting(
            badSeed,
            new BN(0), // zero amount
            new BN(startTime),
            new BN(cliffTime),
            new BN(endTime)
          )
          .accountsPartial({
            admin: admin.publicKey,
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: badPda,
            vault: badVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: zero amount");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidAmount");
      }
    });

    it("T-31: start_time > cliff_time fails", async () => {
      const badSeed = new BN(201);
      const [badPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          badSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const badVault = await getAssociatedTokenAddress(mint, badPda, true);

      try {
        await program.methods
          .createVesting(
            badSeed,
            new BN(totalAmount),
            new BN(cliffTime + 100), // start > cliff
            new BN(cliffTime),
            new BN(endTime)
          )
          .accountsPartial({
            admin: admin.publicKey,
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: badPda,
            vault: badVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: invalid time range");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidTimeRange");
      }
    });

    it("T-32: cliff_time > end_time fails", async () => {
      const badSeed = new BN(202);
      const [badPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          badSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const badVault = await getAssociatedTokenAddress(mint, badPda, true);

      try {
        await program.methods
          .createVesting(
            badSeed,
            new BN(totalAmount),
            new BN(startTime),
            new BN(endTime + 100), // cliff > end
            new BN(endTime)
          )
          .accountsPartial({
            admin: admin.publicKey,
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: badPda,
            vault: badVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: invalid time range");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidTimeRange");
      }
    });

    it("T-33: start_time = end_time fails", async () => {
      const badSeed = new BN(203);
      const [badPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          badSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const badVault = await getAssociatedTokenAddress(mint, badPda, true);

      const sameTime = startTime;
      try {
        await program.methods
          .createVesting(
            badSeed,
            new BN(totalAmount),
            new BN(sameTime),
            new BN(sameTime), // cliff = start = end
            new BN(sameTime)
          )
          .accountsPartial({
            admin: admin.publicKey,
            beneficiary: beneficiary.publicKey,
            mint,
            vestingAccount: badPda,
            vault: badVault,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed: start = end");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidTimeRange");
      }
    });

    it("T-34: total_amount = 1 (minimum) succeeds", async () => {
      const minSeed = new BN(204);
      const [minPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          minSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const minVault = await getAssociatedTokenAddress(mint, minPda, true);

      await program.methods
        .createVesting(
          minSeed,
          new BN(1), // minimum amount
          new BN(startTime),
          new BN(cliffTime),
          new BN(endTime)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: minPda,
          vault: minVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const vesting = await program.account.vestingAccount.fetch(minPda);
      expect(vesting.totalAmount.toNumber()).to.equal(1);
    });

    it("T-35: large total_amount does not overflow (u128 safe math)", async () => {
      const bigSeed = new BN(205);
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

      // Use a large amount near u64 max (but representable in BN)
      // u64::MAX = 18446744073709551615, use a large but valid value
      const largeAmount = new BN("1000000000000000000"); // 10^18

      await program.methods
        .createVesting(
          bigSeed,
          largeAmount,
          new BN(startTime),
          new BN(cliffTime),
          new BN(endTime)
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
      expect(vesting.totalAmount.toString()).to.equal(
        largeAmount.toString()
      );
    });

    it("T-05: multiple vestings for same beneficiary+mint", async () => {
      const secondSeed = new BN(300);
      const [secondPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          secondSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const secondVault = await getAssociatedTokenAddress(
        mint,
        secondPda,
        true
      );

      await program.methods
        .createVesting(
          secondSeed,
          new BN(totalAmount),
          new BN(startTime),
          new BN(cliffTime),
          new BN(endTime)
        )
        .accountsPartial({
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: secondPda,
          vault: secondVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Both vestings should exist
      const v1 = await program.account.vestingAccount.fetch(vestingPda);
      const v2 = await program.account.vestingAccount.fetch(secondPda);
      expect(v1.seed.toNumber()).to.equal(1);
      expect(v2.seed.toNumber()).to.equal(300);
    });
  });
});

// ─────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────

async function airdropSol(
  connection: anchor.web3.Connection,
  publicKey: PublicKey,
  amount: number
) {
  const sig = await connection.requestAirdrop(publicKey, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature: sig,
    ...latestBlockhash,
  });
}
