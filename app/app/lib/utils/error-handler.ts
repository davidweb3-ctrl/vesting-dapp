/**
 * Error handling utilities for wallet transactions
 */

/**
 * Check if an error is a user rejection (wallet cancellation)
 */
export function isUserRejection(error: any): boolean {
  const errorMsg = error?.message || error?.toString() || "";
  return (
    errorMsg.includes("User rejected") ||
    errorMsg.includes("user rejected") ||
    errorMsg.includes("WalletSignTransactionError") ||
    error?.name === "WalletSignTransactionError"
  );
}

/**
 * Map Anchor error codes to user-friendly messages
 */
export function getErrorMessage(error: any, operation: "create" | "deposit" | "claim"): string {
  const errorCode = error?.error?.errorCode?.code;
  const defaultMsg = error?.error?.errorMessage || error?.message || `${operation} failed`;
  
  // User rejection - should be handled silently by caller
  if (isUserRejection(error)) {
    return ""; // Empty string indicates user rejection
  }
  
  // Map specific error codes
  switch (errorCode) {
    case "InvalidTimeRange":
      return "Invalid time range: start_time <= cliff_time <= end_time and start_time < end_time";
    case "InvalidAmount":
      return "Invalid amount: total_amount must be greater than 0";
    case "AlreadyFunded":
      return "Vault is already funded. Each vesting can only be deposited once.";
    case "NotFunded":
      return "Not funded: Admin must deposit tokens into the vault before claiming. Please contact the admin to deposit tokens.";
    case "NothingToClaim":
      return "Nothing to claim: No tokens are available for release at this time. Either the cliff period hasn't passed, or all tokens have already been claimed.";
    case "UnauthorizedAdmin":
      return "Unauthorized: Only the admin who created this vesting can deposit.";
    case "UnauthorizedBeneficiary":
      return "Unauthorized: Only the beneficiary can claim tokens from this vesting schedule.";
    case "MintMismatch":
      return "Mint mismatch: The token mint does not match the vesting schedule.";
    default:
      return defaultMsg;
  }
}
