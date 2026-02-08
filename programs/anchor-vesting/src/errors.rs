use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Invalid time range: must satisfy start <= cliff <= end and start < end")]
    InvalidTimeRange, // 6000

    #[msg("Invalid amount: total_amount must be greater than 0")]
    InvalidAmount, // 6001

    #[msg("Unauthorized: only admin can deposit")]
    UnauthorizedAdmin, // 6002

    #[msg("Unauthorized: only beneficiary can claim")]
    UnauthorizedBeneficiary, // 6003

    #[msg("Already funded: vault already contains tokens")]
    AlreadyFunded, // 6004

    #[msg("Not funded: must deposit before claiming")]
    NotFunded, // 6005

    #[msg("Nothing to claim: no tokens available for release")]
    NothingToClaim, // 6006

    #[msg("Mint mismatch: deposited token mint does not match vesting")]
    MintMismatch, // 6007

    #[msg("Deposit amount mismatch: must equal total_amount")]
    DepositAmountMismatch, // 6008

    #[msg("Arithmetic overflow")]
    Overflow, // 6009
}
