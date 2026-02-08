use anchor_lang::prelude::*;

declare_id!("BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4");

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

#[program]
pub mod anchor_vesting {
    use super::*;

    pub fn create_vesting(
        ctx: Context<CreateVesting>,
        seed: u64,
        total_amount: u64,
        start_time: i64,
        cliff_time: i64,
        end_time: i64,
    ) -> Result<()> {
        instructions::create_vesting::create_vesting_handler(ctx, seed, total_amount, start_time, cliff_time, end_time)
    }

    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        instructions::deposit::deposit_handler(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::claim_handler(ctx)
    }
}
