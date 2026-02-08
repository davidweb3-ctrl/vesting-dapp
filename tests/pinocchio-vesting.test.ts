import * as anchor from "@coral-xyz/anchor";
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
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

const PINOCCHIO_PROGRAM_ID = new PublicKey(
  "EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk"
);

describe("pinocchio-vesting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;

  // Test actors
  const admin = Keypair.generate();
  const beneficiary = Keypair.generate();

  // Token state
  let mint: PublicKey;
  const decimals = 6;
  const totalAmount = 1_000_000 * 10 ** decimals;
  const seed = new BN(1);

  // Derived accounts
  let vestingPda: PublicKey;
  let vestingBump: number;
  let vault: PublicKey;
  let adminAta: PublicKey;

  // Time parameters
  let startTime: number;
  let cliffTime: number;
  let endTime: number;

  function buildCreateVestingIx(
    seed: BN,
    totalAmount: BN,
    startTime: BN,
    cliffTime: BN,
    endTime: BN,
    bump: number,
    accounts: {
      admin: PublicKey;
      beneficiary: PublicKey;
      mint: PublicKey;
      vestingAccount: PublicKey;
      systemProgram: PublicKey;
    }
  ): TransactionInstruction {
    const data = Buffer.alloc(42);
    data[0] = 0; // instruction index
    data.writeBigUInt64LE(BigInt(seed.toString()), 1);
    data.writeBigUInt64LE(BigInt(totalAmount.toString()), 9);
    data.writeBigInt64LE(BigInt(startTime.toString()), 17);
    data.writeBigInt64LE(BigInt(cliffTime.toString()), 25);
    data.writeBigInt64LE(BigInt(endTime.toString()), 33);
    data[41] = bump;

    return new TransactionInstruction({
      programId: PINOCCHIO_PROGRAM_ID,
      keys: [
        { pubkey: accounts.admin, isSigner: true, isWritable: true },
        { pubkey: accounts.beneficiary, isSigner: false, isWritable: false },
        { pubkey: accounts.mint, isSigner: false, isWritable: false },
        { pubkey: accounts.vestingAccount, isSigner: false, isWritable: true },
        { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  function buildDepositIx(accounts: {
    admin: PublicKey;
    mint: PublicKey;
    vestingAccount: PublicKey;
    vault: PublicKey;
    adminTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  }): TransactionInstruction {
    const data = Buffer.from([1]); // instruction index

    return new TransactionInstruction({
      programId: PINOCCHIO_PROGRAM_ID,
      keys: [
        { pubkey: accounts.admin, isSigner: true, isWritable: true },
        { pubkey: accounts.mint, isSigner: false, isWritable: false },
        { pubkey: accounts.vestingAccount, isSigner: false, isWritable: false },
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.adminTokenAccount, isSigner: false, isWritable: true },
        { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  function buildClaimIx(accounts: {
    beneficiary: PublicKey;
    mint: PublicKey;
    vestingAccount: PublicKey;
    vault: PublicKey;
    beneficiaryTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  }): TransactionInstruction {
    const data = Buffer.from([2]); // instruction index

    return new TransactionInstruction({
      programId: PINOCCHIO_PROGRAM_ID,
      keys: [
        { pubkey: accounts.beneficiary, isSigner: true, isWritable: true },
        { pubkey: accounts.mint, isSigner: false, isWritable: false },
        { pubkey: accounts.vestingAccount, isSigner: false, isWritable: true },
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.beneficiaryTokenAccount, isSigner: false, isWritable: true },
        { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  before(async () => {
    // Airdrop SOL
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    await Promise.all([
      airdropSol(connection, admin.publicKey, airdropAmount),
      airdropSol(connection, beneficiary.publicKey, airdropAmount),
    ]);

    // Create SPL Token mint
    mint = await createMint(connection, admin, admin.publicKey, null, decimals);

    // Create admin's ATA and mint tokens
    const adminAtaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mint,
      admin.publicKey
    );
    adminAta = adminAtaAccount.address;
    await mintTo(connection, admin, mint, adminAta, admin, totalAmount * 10);

    // Derive PDA (same seeds as Anchor, just different program ID)
    [vestingPda, vestingBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        beneficiary.publicKey.toBuffer(),
        mint.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      PINOCCHIO_PROGRAM_ID
    );

    vault = await getAssociatedTokenAddress(mint, vestingPda, true);

    // Set time parameters
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const now = blockTime || Math.floor(Date.now() / 1000);
    startTime = now - 10;
    cliffTime = now + 20;
    endTime = now + 60;
  });

  describe("Happy Path", () => {
    it("creates vesting with valid parameters", async () => {
      const ix = buildCreateVestingIx(
        seed,
        new BN(totalAmount),
        new BN(startTime),
        new BN(cliffTime),
        new BN(endTime),
        vestingBump,
        {
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: vestingPda,
          systemProgram: SystemProgram.programId,
        }
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [admin]);

      // Verify by reading raw account data
      const account = await connection.getAccountInfo(vestingPda);
      expect(account).to.not.be.null;
      expect(account!.data.length).to.equal(145);
      expect(account!.owner.toString()).to.equal(PINOCCHIO_PROGRAM_ID.toString());

      // Parse stored data
      const data = account!.data;
      const storedAdmin = new PublicKey(data.subarray(0, 32));
      const storedBeneficiary = new PublicKey(data.subarray(32, 64));
      const storedMint = new PublicKey(data.subarray(64, 96));
      const storedTotalAmount = data.readBigUInt64LE(96);
      const storedReleasedAmount = data.readBigUInt64LE(104);

      expect(storedAdmin.toString()).to.equal(admin.publicKey.toString());
      expect(storedBeneficiary.toString()).to.equal(beneficiary.publicKey.toString());
      expect(storedMint.toString()).to.equal(mint.toString());
      expect(Number(storedTotalAmount)).to.equal(totalAmount);
      expect(Number(storedReleasedAmount)).to.equal(0);
    });

    it("deposits tokens after creating vault ATA", async () => {
      // Create vault ATA (since pinocchio program doesn't auto-create it)
      // allowOwnerOffCurve = true because vestingPda is a PDA (off-curve)
      await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        vestingPda,
        true // allowOwnerOffCurve
      );

      const ix = buildDepositIx({
        admin: admin.publicKey,
        mint,
        vestingAccount: vestingPda,
        vault,
        adminTokenAccount: adminAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [admin]);

      // Verify vault balance
      const vaultAccount = await getAccount(connection, vault);
      expect(Number(vaultAccount.amount)).to.equal(totalAmount);
    });
  });

  describe("Claim (time-dependent)", () => {
    it("claims all tokens for fully expired vesting", async () => {
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      // Create a fully expired vesting
      const expSeed = new BN(10);
      const [expPda, expBump] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          expSeed.toArrayLike(Buffer, "le", 8),
        ],
        PINOCCHIO_PROGRAM_ID
      );

      const ix = buildCreateVestingIx(
        expSeed,
        new BN(totalAmount),
        new BN(now - 200),
        new BN(now - 150),
        new BN(now - 50),
        expBump,
        {
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: expPda,
          systemProgram: SystemProgram.programId,
        }
      );
      await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
        admin,
      ]);

      // Create vault ATA and deposit
      const expVault = await getAssociatedTokenAddress(mint, expPda, true);
      await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        expPda,
        true
      );

      const depIx = buildDepositIx({
        admin: admin.publicKey,
        mint,
        vestingAccount: expPda,
        vault: expVault,
        adminTokenAccount: adminAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      });
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(depIx),
        [admin]
      );

      // Claim
      const beneficiaryAta = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );
      await getOrCreateAssociatedTokenAccount(
        connection,
        beneficiary,
        mint,
        beneficiary.publicKey
      );

      const claimIx = buildClaimIx({
        beneficiary: beneficiary.publicKey,
        mint,
        vestingAccount: expPda,
        vault: expVault,
        beneficiaryTokenAccount: beneficiaryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      });
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(claimIx),
        [beneficiary]
      );

      // Verify all tokens released
      const account = await connection.getAccountInfo(expPda);
      const data = account!.data;
      const releasedAmount = Number(data.readBigUInt64LE(104));
      expect(releasedAmount).to.equal(totalAmount);

      // Vault should be empty
      const vaultAccount = await getAccount(connection, expVault);
      expect(Number(vaultAccount.amount)).to.equal(0);
    });
  });

  describe("Security", () => {
    it("non-admin cannot deposit", async () => {
      // Create a fresh vesting to test unauthorized deposit
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const now = blockTime || Math.floor(Date.now() / 1000);

      const uaSeed = new BN(20);
      const [uaPda, uaBump] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          uaSeed.toArrayLike(Buffer, "le", 8),
        ],
        PINOCCHIO_PROGRAM_ID
      );

      const createIx = buildCreateVestingIx(
        uaSeed,
        new BN(totalAmount),
        new BN(now - 10),
        new BN(now + 20),
        new BN(now + 60),
        uaBump,
        {
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: uaPda,
          systemProgram: SystemProgram.programId,
        }
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(createIx),
        [admin]
      );

      const uaVault = await getAssociatedTokenAddress(mint, uaPda, true);
      await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        uaPda,
        true
      );

      // Beneficiary tries to deposit (not admin)
      const beneficiaryAtaAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        beneficiary,
        mint,
        beneficiary.publicKey
      );

      const depIx = buildDepositIx({
        admin: beneficiary.publicKey, // Wrong admin
        mint,
        vestingAccount: uaPda,
        vault: uaVault,
        adminTokenAccount: beneficiaryAtaAcc.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(depIx),
          [beneficiary]
        );
        expect.fail("Should have failed: unauthorized admin");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });

    it("duplicate deposit fails", async () => {
      // vault already funded from happy path; try again
      const depIx = buildDepositIx({
        admin: admin.publicKey,
        mint,
        vestingAccount: vestingPda,
        vault,
        adminTokenAccount: adminAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(depIx),
          [admin]
        );
        expect.fail("Should have failed: already funded");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });

    it("claim fails before cliff (nothing to claim)", async () => {
      const beneficiaryAta = await getAssociatedTokenAddress(
        mint,
        beneficiary.publicKey
      );

      // Create beneficiary ATA
      await getOrCreateAssociatedTokenAccount(
        connection,
        beneficiary,
        mint,
        beneficiary.publicKey
      );

      const ix = buildClaimIx({
        beneficiary: beneficiary.publicKey,
        mint,
        vestingAccount: vestingPda,
        vault,
        beneficiaryTokenAccount: beneficiaryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [beneficiary]);
        expect.fail("Should have failed: cliff not reached");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });
  });

  describe("Boundary", () => {
    it("total_amount = 0 fails", async () => {
      const badSeed = new BN(200);
      const [badPda, badBump] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          badSeed.toArrayLike(Buffer, "le", 8),
        ],
        PINOCCHIO_PROGRAM_ID
      );

      const ix = buildCreateVestingIx(
        badSeed,
        new BN(0),
        new BN(startTime),
        new BN(cliffTime),
        new BN(endTime),
        badBump,
        {
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: badPda,
          systemProgram: SystemProgram.programId,
        }
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [admin]);
        expect.fail("Should have failed: zero amount");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });

    it("invalid time range fails", async () => {
      const badSeed = new BN(201);
      const [badPda, badBump] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vesting"),
          beneficiary.publicKey.toBuffer(),
          mint.toBuffer(),
          badSeed.toArrayLike(Buffer, "le", 8),
        ],
        PINOCCHIO_PROGRAM_ID
      );

      const ix = buildCreateVestingIx(
        badSeed,
        new BN(totalAmount),
        new BN(endTime), // start > end
        new BN(cliffTime),
        new BN(startTime),
        badBump,
        {
          admin: admin.publicKey,
          beneficiary: beneficiary.publicKey,
          mint,
          vestingAccount: badPda,
          systemProgram: SystemProgram.programId,
        }
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [admin]);
        expect.fail("Should have failed: invalid time range");
      } catch (err: any) {
        expect(err.toString()).to.include("Error");
      }
    });
  });
});

async function airdropSol(
  connection: anchor.web3.Connection,
  publicKey: PublicKey,
  amount: number
) {
  const sig = await connection.requestAirdrop(publicKey, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
}
