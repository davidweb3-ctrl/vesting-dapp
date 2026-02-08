use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::errors::VestingError;
use crate::state::VestingAccount;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        has_one = beneficiary @ VestingError::UnauthorizedBeneficiary,
        has_one = mint @ VestingError::MintMismatch,
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vesting_account,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = beneficiary,
        associated_token::mint = mint,
        associated_token::authority = beneficiary,
        associated_token::token_program = token_program,
    )]
    pub beneficiary_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn claim_handler(ctx: Context<Claim>) -> Result<()> {
    let vesting = &ctx.accounts.vesting_account;

    // Ensure vault is funded
    require!(ctx.accounts.vault.amount > 0, VestingError::NotFunded);

    // Get current time from Solana Clock
    let now = Clock::get()?.unix_timestamp;

    // Calculate claimable amount
    let claimable = vesting.claimable(now)?;
    require!(claimable > 0, VestingError::NothingToClaim);

    // Build PDA signer seeds
    let beneficiary_key = vesting.beneficiary;
    let mint_key = vesting.mint;
    let seed_bytes = vesting.seed.to_le_bytes();
    let bump_bytes = [vesting.bump];

    let signer_seeds: &[&[u8]] = &[
        b"vesting",
        beneficiary_key.as_ref(),
        mint_key.as_ref(),
        &seed_bytes,
        &bump_bytes,
    ];
    let signer = &[signer_seeds];

    // Transfer claimable tokens from vault to beneficiary
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.beneficiary_token_account.to_account_info(),
        authority: ctx.accounts.vesting_account.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        signer,
    );

    token_interface::transfer_checked(
        cpi_ctx,
        claimable,
        ctx.accounts.mint.decimals,
    )?;

    // Update released_amount (monotonically increasing)
    let vesting = &mut ctx.accounts.vesting_account;
    vesting.released_amount = vesting
        .released_amount
        .checked_add(claimable)
        .ok_or(VestingError::Overflow)?;

    msg!(
        "Claimed {} tokens. Total released: {}/{}",
        claimable,
        vesting.released_amount,
        vesting.total_amount,
    );

    Ok(())
}
