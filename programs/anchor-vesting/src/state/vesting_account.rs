use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VestingAccount {
    /// The admin (Project Owner) who created this vesting
    pub admin: Pubkey,
    /// The beneficiary who can claim tokens
    pub beneficiary: Pubkey,
    /// The SPL Token mint
    pub mint: Pubkey,
    /// Total amount of tokens to be vested
    pub total_amount: u64,
    /// Amount of tokens already released/claimed
    pub released_amount: u64,
    /// Vesting start time (unix timestamp)
    pub start_time: i64,
    /// Cliff end time (unix timestamp) - no tokens released before this
    pub cliff_time: i64,
    /// Vesting end time (unix timestamp) - all tokens released after this
    pub end_time: i64,
    /// Unique seed to allow multiple vestings per beneficiary+mint
    pub seed: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl VestingAccount {
    /// Calculate the total amount of tokens that should be released by `now`.
    /// Uses u128 intermediate math to prevent overflow.
    pub fn calculate_released(&self, now: i64) -> Result<u64> {
        // Before cliff: nothing released
        if now < self.cliff_time {
            return Ok(0);
        }

        // After end: everything released
        if now >= self.end_time {
            return Ok(self.total_amount);
        }

        // Linear release between start_time and end_time
        let elapsed = (now - self.start_time) as u128;
        let duration = (self.end_time - self.start_time) as u128;
        let total = self.total_amount as u128;

        let released = total
            .checked_mul(elapsed)
            .ok_or(error!(crate::errors::VestingError::Overflow))?
            .checked_div(duration)
            .ok_or(error!(crate::errors::VestingError::Overflow))?;

        Ok(released as u64)
    }

    /// Calculate the amount currently claimable (released but not yet claimed)
    pub fn claimable(&self, now: i64) -> Result<u64> {
        let total_released = self.calculate_released(now)?;
        Ok(total_released.saturating_sub(self.released_amount))
    }
}
