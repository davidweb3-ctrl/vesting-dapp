use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::errors::VestingError;
use crate::state::VestingAccount;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateVesting<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: beneficiary does not need to sign
    pub beneficiary: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + VestingAccount::INIT_SPACE,
        seeds = [
            b"vesting",
            beneficiary.key().as_ref(),
            mint.key().as_ref(),
            &seed.to_le_bytes(),
        ],
        bump,
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = vesting_account,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn create_vesting_handler(
    ctx: Context<CreateVesting>,
    seed: u64,
    total_amount: u64,
    start_time: i64,
    cliff_time: i64,
    end_time: i64,
) -> Result<()> {
    // Validate parameters
    require!(total_amount > 0, VestingError::InvalidAmount);
    require!(
        start_time <= cliff_time && cliff_time <= end_time && start_time < end_time,
        VestingError::InvalidTimeRange
    );

    let vesting = &mut ctx.accounts.vesting_account;
    vesting.admin = ctx.accounts.admin.key();
    vesting.beneficiary = ctx.accounts.beneficiary.key();
    vesting.mint = ctx.accounts.mint.key();
    vesting.total_amount = total_amount;
    vesting.released_amount = 0;
    vesting.start_time = start_time;
    vesting.cliff_time = cliff_time;
    vesting.end_time = end_time;
    vesting.seed = seed;
    vesting.bump = ctx.bumps.vesting_account;

    msg!(
        "Vesting created: beneficiary={}, mint={}, amount={}, seed={}",
        vesting.beneficiary,
        vesting.mint,
        vesting.total_amount,
        vesting.seed,
    );

    Ok(())
}
