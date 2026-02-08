use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::errors::VestingError;
use crate::state::VestingAccount;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        has_one = admin @ VestingError::UnauthorizedAdmin,
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
        mut,
        associated_token::mint = mint,
        associated_token::authority = admin,
        associated_token::token_program = token_program,
    )]
    pub admin_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn deposit_handler(ctx: Context<Deposit>) -> Result<()> {
    let vesting = &ctx.accounts.vesting_account;

    // Ensure vault is empty (not already funded)
    require!(ctx.accounts.vault.amount == 0, VestingError::AlreadyFunded);

    // Transfer total_amount from admin to vault
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.admin_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.admin.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );

    token_interface::transfer_checked(
        cpi_ctx,
        vesting.total_amount,
        ctx.accounts.mint.decimals,
    )?;

    msg!(
        "Deposited {} tokens into vault for vesting {}",
        vesting.total_amount,
        ctx.accounts.vesting_account.key(),
    );

    Ok(())
}
