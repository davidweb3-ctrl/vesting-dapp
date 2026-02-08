use pinocchio::{
    cpi::{Seed, Signer},
    entrypoint, AccountView, Address, ProgramResult,
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::TransferChecked;

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/// Vesting account data size (no Anchor discriminator)
const VESTING_SIZE: usize = 145;

// Account data field offsets
const ADMIN_OFF: usize = 0;
const BENEFICIARY_OFF: usize = 32;
const MINT_OFF: usize = 64;
const TOTAL_AMOUNT_OFF: usize = 96;
const RELEASED_AMOUNT_OFF: usize = 104;
const START_TIME_OFF: usize = 112;
const CLIFF_TIME_OFF: usize = 120;
const END_TIME_OFF: usize = 128;
const SEED_OFF: usize = 136;
const BUMP_OFF: usize = 144;

// ─────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    match data[0] {
        0 => process_create_vesting(program_id, accounts, &data[1..]),
        1 => process_deposit(program_id, accounts, &data[1..]),
        2 => process_claim(program_id, accounts, &data[1..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ─────────────────────────────────────────────
// Instruction 0: Create Vesting
// ─────────────────────────────────────────────
// Data: seed(8) + total_amount(8) + start_time(8) + cliff_time(8) + end_time(8) + bump(1) = 41 bytes
// Accounts: [admin(s,w), beneficiary, mint, vesting_account(w), system_program]

fn process_create_vesting(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 5 || data.len() < 41 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let admin = &accounts[0];
    let beneficiary = &accounts[1];
    let mint = &accounts[2];
    let vesting_account = &accounts[3];
    let _system_program = &accounts[4];

    // Parse instruction data
    let seed = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let total_amount = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let start_time = i64::from_le_bytes(data[16..24].try_into().unwrap());
    let cliff_time = i64::from_le_bytes(data[24..32].try_into().unwrap());
    let end_time = i64::from_le_bytes(data[32..40].try_into().unwrap());
    let bump = data[40];

    // Validate signer
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate parameters
    if total_amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    if !(start_time <= cliff_time && cliff_time <= end_time && start_time < end_time) {
        return Err(ProgramError::InvalidArgument);
    }

    // Build PDA signer seeds
    let seed_bytes = seed.to_le_bytes();
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(b"vesting" as &[u8]),
        Seed::from(beneficiary.address().as_ref()),
        Seed::from(mint.address().as_ref()),
        Seed::from(&seed_bytes as &[u8]),
        Seed::from(&bump_bytes as &[u8]),
    ];
    let signer = Signer::from(&seeds);

    // Create the vesting PDA account via system program CPI
    let rent = Rent::get()?;
    #[allow(deprecated)]
    let lamports = rent.minimum_balance(VESTING_SIZE);

    CreateAccount {
        from: admin,
        to: vesting_account,
        lamports,
        space: VESTING_SIZE as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // Write vesting account data
    let mut acct_data = vesting_account.try_borrow_mut()?;
    acct_data[ADMIN_OFF..ADMIN_OFF + 32].copy_from_slice(admin.address().as_ref());
    acct_data[BENEFICIARY_OFF..BENEFICIARY_OFF + 32].copy_from_slice(beneficiary.address().as_ref());
    acct_data[MINT_OFF..MINT_OFF + 32].copy_from_slice(mint.address().as_ref());
    acct_data[TOTAL_AMOUNT_OFF..TOTAL_AMOUNT_OFF + 8].copy_from_slice(&total_amount.to_le_bytes());
    acct_data[RELEASED_AMOUNT_OFF..RELEASED_AMOUNT_OFF + 8].copy_from_slice(&0u64.to_le_bytes());
    acct_data[START_TIME_OFF..START_TIME_OFF + 8].copy_from_slice(&start_time.to_le_bytes());
    acct_data[CLIFF_TIME_OFF..CLIFF_TIME_OFF + 8].copy_from_slice(&cliff_time.to_le_bytes());
    acct_data[END_TIME_OFF..END_TIME_OFF + 8].copy_from_slice(&end_time.to_le_bytes());
    acct_data[SEED_OFF..SEED_OFF + 8].copy_from_slice(&seed.to_le_bytes());
    acct_data[BUMP_OFF] = bump;
    drop(acct_data);

    solana_program_log::log("Vesting account created");
    Ok(())
}

// ─────────────────────────────────────────────
// Instruction 1: Deposit
// ─────────────────────────────────────────────
// Data: empty
// Accounts: [admin(s,w), mint, vesting_account, vault(w), admin_token_account(w), token_program]

fn process_deposit(
    program_id: &Address,
    accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    if accounts.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let admin = &accounts[0];
    let mint = &accounts[1];
    let vesting_account = &accounts[2];
    let vault = &accounts[3];
    let admin_token_account = &accounts[4];
    let _token_program = &accounts[5];

    // Validate signer
    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate ownership
    if !vesting_account.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Read vesting data (copy to locals, then drop borrow)
    let (stored_admin, stored_mint, total_amount) = {
        let d = vesting_account.try_borrow()?;
        let mut a = [0u8; 32];
        a.copy_from_slice(&d[ADMIN_OFF..ADMIN_OFF + 32]);
        let mut m = [0u8; 32];
        m.copy_from_slice(&d[MINT_OFF..MINT_OFF + 32]);
        let t = u64::from_le_bytes(d[TOTAL_AMOUNT_OFF..TOTAL_AMOUNT_OFF + 8].try_into().unwrap());
        (a, m, t)
    };

    // Verify admin
    if stored_admin != *admin.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify mint
    if stored_mint != *mint.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Check vault is empty (SPL token account amount at offset 64)
    let vault_amount = {
        let d = vault.try_borrow()?;
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    };
    if vault_amount != 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Read mint decimals (offset 44 in Mint layout)
    let decimals = {
        let d = mint.try_borrow()?;
        d[44]
    };

    // Transfer total_amount from admin to vault
    TransferChecked {
        from: admin_token_account,
        mint,
        to: vault,
        authority: admin,
        amount: total_amount,
        decimals,
    }
    .invoke()?;

    solana_program_log::log("Tokens deposited into vault");
    Ok(())
}

// ─────────────────────────────────────────────
// Instruction 2: Claim
// ─────────────────────────────────────────────
// Data: empty
// Accounts: [beneficiary(s,w), mint, vesting_account(w), vault(w),
//            beneficiary_token_account(w), token_program]

fn process_claim(
    program_id: &Address,
    accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    if accounts.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let beneficiary = &accounts[0];
    let mint = &accounts[1];
    let vesting_account = &accounts[2];
    let vault = &accounts[3];
    let beneficiary_ata = &accounts[4];
    let _token_program = &accounts[5];

    // Validate signer
    if !beneficiary.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate ownership
    if !vesting_account.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Read all vesting data (copy to locals, then drop borrow)
    let (stored_beneficiary, stored_mint, total_amount, released_amount,
         start_time, cliff_time, end_time, seed, bump) = {
        let d = vesting_account.try_borrow()?;
        let mut b = [0u8; 32];
        b.copy_from_slice(&d[BENEFICIARY_OFF..BENEFICIARY_OFF + 32]);
        let mut m = [0u8; 32];
        m.copy_from_slice(&d[MINT_OFF..MINT_OFF + 32]);
        let ta = u64::from_le_bytes(d[TOTAL_AMOUNT_OFF..TOTAL_AMOUNT_OFF + 8].try_into().unwrap());
        let ra = u64::from_le_bytes(d[RELEASED_AMOUNT_OFF..RELEASED_AMOUNT_OFF + 8].try_into().unwrap());
        let st = i64::from_le_bytes(d[START_TIME_OFF..START_TIME_OFF + 8].try_into().unwrap());
        let ct = i64::from_le_bytes(d[CLIFF_TIME_OFF..CLIFF_TIME_OFF + 8].try_into().unwrap());
        let et = i64::from_le_bytes(d[END_TIME_OFF..END_TIME_OFF + 8].try_into().unwrap());
        let sd = u64::from_le_bytes(d[SEED_OFF..SEED_OFF + 8].try_into().unwrap());
        let bp = d[BUMP_OFF];
        (b, m, ta, ra, st, ct, et, sd, bp)
    };

    // Verify beneficiary
    if stored_beneficiary != *beneficiary.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify mint
    if stored_mint != *mint.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Check vault is funded
    let vault_amount = {
        let d = vault.try_borrow()?;
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    };
    if vault_amount == 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Get current time
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Calculate released amount
    let total_released = calculate_released(total_amount, start_time, cliff_time, end_time, now);
    let claimable = total_released.saturating_sub(released_amount);

    if claimable == 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Build PDA signer seeds
    let seed_bytes = seed.to_le_bytes();
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(b"vesting" as &[u8]),
        Seed::from(beneficiary.address().as_ref()),
        Seed::from(mint.address().as_ref()),
        Seed::from(&seed_bytes as &[u8]),
        Seed::from(&bump_bytes as &[u8]),
    ];
    let signer = Signer::from(&seeds);

    // Read mint decimals
    let decimals = {
        let d = mint.try_borrow()?;
        d[44]
    };

    // Transfer claimable tokens from vault to beneficiary
    TransferChecked {
        from: vault,
        mint,
        to: beneficiary_ata,
        authority: vesting_account,
        amount: claimable,
        decimals,
    }
    .invoke_signed(&[signer])?;

    // Update released_amount
    {
        let mut data = vesting_account.try_borrow_mut()?;
        let new_released = released_amount + claimable;
        data[RELEASED_AMOUNT_OFF..RELEASED_AMOUNT_OFF + 8]
            .copy_from_slice(&new_released.to_le_bytes());
    }

    solana_program_log::log("Tokens claimed successfully");
    Ok(())
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

fn calculate_released(
    total_amount: u64,
    start_time: i64,
    cliff_time: i64,
    end_time: i64,
    now: i64,
) -> u64 {
    if now < cliff_time {
        return 0;
    }
    if now >= end_time {
        return total_amount;
    }
    let elapsed = (now - start_time) as u128;
    let duration = (end_time - start_time) as u128;
    let total = total_amount as u128;
    ((total * elapsed) / duration) as u64
}
