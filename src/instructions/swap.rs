use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    ProgramResult,
};
use aranya_base58::ToBase58;
use pinocchio_log::log;
use pinocchio_token::{
    instructions::{TransferChecked, CloseAccount},
    state::{TokenAccount, Mint},
};
use pinocchio_system::instructions::Transfer;
use pinocchio_associated_token_account::instructions::{Create, CreateIdempotent};
use five8_const::decode_32_const;
use shank::ShankAccount;

use crate::states::{
    utils::{load_acc_unchecked, DataLen},
    SwapState,
};
use crate::errors::SwapError;
use core::u64;

#[repr(C, packed)]
#[derive(Clone, Copy, Debug, PartialEq, ShankAccount)]
pub struct SwapData {
    /// Amount of quote tokens the user is willing to pay.
    pub quote_in: u64,
}

impl DataLen for SwapData {
    const LEN: usize = core::mem::size_of::<SwapData>();
}

pub fn swap(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    log!("Begin Swap");

    let [
        user_acc,
        swap_acc,
        vault_base_acc,
        vault_quote_acc,
        user_base_acc,
        user_quote_acc,
        base_mint_acc,
        quote_mint_acc,
        bonus_base_acc,
        bonus_quote_acc,
        wsol_temp_acc,
        token_program_acc,
        system_program_acc,
        _ata_program_acc,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !user_acc.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // log!("Data length: {}, expected: {}", data.len(), SwapData::LEN);
    if data.len() != SwapData::LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let swap_data = unsafe { *(data.as_ptr() as *const SwapData) };
    if swap_data.quote_in == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Load swap state
    let swap_state = unsafe { load_acc_unchecked::<SwapState>(swap_acc.borrow_data_unchecked()) }?;

    // Decode all accounts once and extract needed values
    let vault_base = TokenAccount::from_account_info(vault_base_acc)?;
    let user_base = TokenAccount::from_account_info(user_base_acc)?;
    let user_quote = TokenAccount::from_account_info(user_quote_acc)?;
    let base_mint = Mint::from_account_info(base_mint_acc)?;

    // Extract all needed values immediately
    let vault_base_owner = *vault_base.owner();
    let vault_base_mint = *vault_base.mint();
    let user_base_mint = *user_base.mint();
    let user_quote_mint = *user_quote.mint();
    let base_decimals = base_mint.decimals();
    let mut quote_decimals = 9;
    if !swap_state.quote_sol {
        let quote_mint = Mint::from_account_info(quote_mint_acc)?;
        quote_decimals = quote_mint.decimals();
    }

    // Ownership & mint invariants + mint matching
    if swap_state.base != *vault_base_acc.key() {
        return Err(crate::errors::SwapError::WrongVaultBase.into());
    }
    if swap_state.quote != *vault_quote_acc.key() {
        return Err(crate::errors::SwapError::WrongVaultQuote.into());
    }
    if vault_base_owner != *swap_acc.key() {
        return Err(crate::errors::SwapError::WrongOwnerBase.into());
    }
    if vault_base_mint != user_base_mint {
        return Err(crate::errors::SwapError::WrongMintBase.into());
    }
    if vault_base_mint != *base_mint_acc.key() {
        return Err(crate::errors::SwapError::WrongMintBase.into());
    }

    if !swap_state.quote_sol {
        let vault_quote = TokenAccount::from_account_info(vault_quote_acc)?;
        let vault_quote_owner = *vault_quote.owner();
        let vault_quote_mint = *vault_quote.mint();
        if vault_quote_owner == *swap_acc.key() {
            return Err(crate::errors::SwapError::WrongOwnerQuote.into());
        }
        if vault_quote_mint != user_quote_mint {
            return Err(crate::errors::SwapError::WrongMintQuote.into());
        }
        if vault_quote_mint != *quote_mint_acc.key() {
            return Err(crate::errors::SwapError::WrongMintQuote.into());
        }
    } else {
        if *quote_mint_acc.key() != decode_32_const("So11111111111111111111111111111111111111112") {
            return Err(crate::errors::SwapError::WrongMintQuote.into());
        }
    }

    // Drop the borrowed account structs to release borrows before transfers
    drop(vault_base);
    drop(user_base);
    drop(user_quote);
    drop(base_mint);

    // Compute base_out (base smallest units) from quote_in (quote smallest units) and 1e9-scaled price.
    let quote_in_units: u128 = swap_data.quote_in as u128;
    let price_scaled: u128 = swap_state.price as u128; // 1e9-scaled price of 1 base in quote
    let base_out: u64 = compute_base_units(quote_in_units, price_scaled, base_decimals, quote_decimals)?;
    
    let mut quote_in_bonus = 0;
    // SPL token or WSOL/SOL
    if swap_state.bonus_quote != 0 && *bonus_quote_acc.key() != *user_quote_acc.key() {
        quote_in_bonus = calculate_quote_bonus(swap_state.bonus_quote, swap_data.quote_in)?;
        log!("Quote bonus: {}", quote_in_bonus);
    }

    let quote_in_vault: u64 = swap_data.quote_in.checked_sub(quote_in_bonus).ok_or(SwapError::InvalidParameters)?;
    
    // Transfer base from vault_base to user using PDA signer
    let uuid_binding = swap_state.uuid.to_le_bytes();
    let pda_bump_bytes = [swap_state.bump_seed];
    let signer_seeds = [
        Seed::from(&uuid_binding),
        Seed::from(&pda_bump_bytes[..]),
    ];
    let signers = [Signer::from(&signer_seeds[..])];
    
    // Transfer quote from user to vault_quot
    if swap_state.quote_sol {
        // Idempotent create WSOL ATA
        log!("Create temp WSOL ATA");
        CreateIdempotent {
            funding_account: user_acc,
            account: wsol_temp_acc,
            wallet: swap_acc,
            mint: quote_mint_acc,
            system_program: system_program_acc,
            token_program: token_program_acc,
        }
        .invoke_signed(&signers)?;

        // First tranfer from user
        log!("Transfer quote from user to temp WSOL ATA");
        TransferChecked {
            from: user_quote_acc,
            mint: quote_mint_acc, // WSOL
            to: wsol_temp_acc,
            authority: user_acc,
            amount: quote_in_vault,
            decimals: quote_decimals,
        }
        .invoke()?;

        log!("Close temp WSOL ATA");
        CloseAccount {
            account: wsol_temp_acc,
            destination: user_acc,
            authority: swap_acc,
        }
        .invoke_signed(&signers)?;
        
        // Transfer SOL from user acc to swap_state.quote
        log!("Transfer SOL from user to vault");
        Transfer {
            from: user_acc,
            to: vault_quote_acc,
            lamports: quote_in_vault,
        }
        .invoke()?;
    } else {
        log!("Transfer quote token from user to vault: {}", quote_in_vault);
        TransferChecked {
            from: user_quote_acc,
            mint: quote_mint_acc,
            to: vault_quote_acc,
            authority: user_acc,
            amount: quote_in_vault,
            decimals: quote_decimals,
        }
        .invoke()?;
    }

    // SPL token or WSOL/SOL
    if quote_in_bonus > 0 {
        if swap_state.quote_sol {
            // Transfer to swap_state.quote as a regular lamports balance
            // Receive as wrapped SOL to an WSOL ATA owned by the swap account

            Create {
                funding_account: user_acc,
                account: wsol_temp_acc,
                wallet: swap_acc,
                mint: quote_mint_acc,
                system_program: system_program_acc,
                token_program: token_program_acc,
            }
            .invoke_signed(&signers)?;

            // Transfer WSOL
            TransferChecked {
                from: user_quote_acc,
                mint: quote_mint_acc,
                to: wsol_temp_acc,
                authority: user_acc,
                amount: quote_in_bonus,
                decimals: quote_decimals,
            }
            .invoke()?;

            // Close WSOL ATA
            CloseAccount {
                account: wsol_temp_acc,
                destination: user_acc,
                authority: swap_acc,
            }
            .invoke_signed(&signers)?; 

            Transfer {
                from: user_acc,
                to: bonus_quote_acc,
                lamports: quote_in_bonus,
            }
            .invoke()?;
        } else {
            //let _quote_ata_bonus = TokenAccount::from_account_info(bonus_quote_acc)?;
            log!("Transfer quote from user to bonus: {}", quote_in_bonus);
            TransferChecked {
                from: user_quote_acc,
                mint: quote_mint_acc,
                to: bonus_quote_acc,
                authority: user_acc,
                amount: quote_in_bonus,
                decimals: quote_decimals,
            }
            .invoke()?;
        }
    }

    // Base tokens

    log!("Transfer base from vault to user: {}", base_out);
    TransferChecked {
        from: vault_base_acc,
        mint: base_mint_acc,
        to: user_base_acc,
        authority: swap_acc,
        amount: base_out,
        decimals: base_decimals,
    }
    .invoke_signed(&signers)?;

    // Always SPL token
    if swap_state.bonus_base != 0 && *bonus_base_acc.key() != *user_base_acc.key() {
        let base_ata_bonus = TokenAccount::from_account_info(bonus_base_acc)?;
        if *base_ata_bonus.mint() != *base_mint_acc.key() {
            return Err(SwapError::WrongMintBase.into());
        }
        let bonus_base_amount = calculate_base_bonus(swap_state.bonus_base as u128, base_out)?;
        log!("Bonus base: {}", bonus_base_amount);
        // Drop the immutable borrow on bonus_base_acc before doing a transfer that
        // will require a (mutable) borrow of the same account.
        drop(base_ata_bonus);
        log!("Transfer base from vault to bonus: {}", bonus_base_amount);
        TransferChecked {
            from: vault_base_acc,
            mint: base_mint_acc,
            to: bonus_base_acc,
            authority: swap_acc,
            amount: bonus_base_amount,
            decimals: base_decimals,
        }
        .invoke_signed(&signers)?;
    }

    log!("Swap Completed");
    // log!("quote_in={} -> base_out={} price={}", swap_data.quote_in, base_out, swap_state.price);
    Ok(())
}

/// Calculate base token bonus based on percentage
/// 
/// # Arguments
/// * `bonus_percentage` - Bonus percentage scaled by 1e9 (100 billion = 100%)
/// * `base_out` - Base tokens output from the swap
/// 
/// # Returns
/// * `Result<u64, ProgramError>` - Bonus amount in base token smallest units
/// 
/// # Formula
/// bonus_amount = (base_out * bonus_percentage) / 100_000_000_000
/// 
/// # Examples
/// * bonus_percentage = 0 -> bonus_amount = 0 (0%)
/// * bonus_percentage = 1_000_000_000 -> bonus_amount = base_out * 0.01 (1%)
/// * bonus_percentage = 100_000_000_000 -> bonus_amount = base_out (100%)
#[inline(always)]
fn calculate_base_bonus(
    bonus_percentage: u128,
    base_out: u64,
) -> Result<u64, ProgramError> {
    // If no bonus, return 0
    if bonus_percentage == 0 {
        return Ok(0);
    }
    
    // Convert base_out to u128 for calculation
    let base_out_128 = base_out as u128;
    
    // Calculate bonus: (base_out * bonus_percentage) / 100_000_000_000
    // This gives us the bonus amount in base token smallest units
    let numerator = base_out_128
        .checked_mul(bonus_percentage)
        .ok_or(SwapError::InvalidParameters)?;
    
    let denominator = 100_000_000_000u128; // 100 billion (100%)
    
    let bonus_amount = numerator
        .checked_div(denominator)
        .ok_or(SwapError::InvalidParameters)?;
    
    // Ensure the result fits in u64
    if bonus_amount > (u64::MAX as u128) {
        return Err(SwapError::InvalidParameters.into());
    }
    
    Ok(bonus_amount as u64)
}


/// Calculate quote token bonus based on percentage
/// 
/// # Arguments
/// * `bonus_percentage` - Bonus percentage scaled by 1e9 (100 billion = 100%)
/// * `quote_in` - Quote tokens the user is paying
/// 
/// # Returns
/// * `Result<u64, ProgramError>` - Bonus amount in quote token smallest units
/// 
/// # Formula
/// bonus_amount = (quote_in * bonus_percentage) / 100_000_000_000
#[inline(always)]
fn calculate_quote_bonus(
    bonus_percentage: u64,
    quote_in: u64,
) -> Result<u64, ProgramError> {
    if bonus_percentage == 0 {
        return Ok(0);
    }

    let quote_in_128 = quote_in as u128;
    let bonus_percentage_128 = bonus_percentage as u128;

    let numerator = quote_in_128
        .checked_mul(bonus_percentage_128)
        .ok_or(SwapError::InvalidParameters)?;

    let denominator = 100_000_000_000u128; // 100 * 1e9

    let bonus_amount = numerator
        .checked_div(denominator)
        .ok_or(SwapError::InvalidParameters)?;

    if bonus_amount > (u64::MAX as u128) {
        return Err(SwapError::InvalidParameters.into());
    }

    Ok(bonus_amount as u64)
}


#[inline(always)]
fn compute_base_units(
    quote_units: u128,
    price_scaled: u128,
    base_decimals: u8,
    quote_decimals: u8,
) -> Result<u64, ProgramError> {
    // price_scaled: 1e9-scaled price of 1 base in quote (post-decimals)
    // Compute base_units = (quote_units * 10^base_decimals * 1e9) / (price_scaled * 10^quote_decimals)
    if price_scaled == 0 {
        return Err(SwapError::InvalidParameters.into());
    }
    let b: u128 = 1_000_000_000u128;
    let base_scale: u128 = 10u128
        .checked_pow(base_decimals as u32)
        .ok_or(SwapError::InvalidParameters)?;
    let quote_scale: u128 = 10u128
        .checked_pow(quote_decimals as u32)
        .ok_or(SwapError::InvalidParameters)?;

    let num: u128 = quote_units
        .checked_mul(base_scale)
        .and_then(|v| v.checked_mul(b))
        .ok_or(SwapError::InvalidParameters)?;
    let den: u128 = price_scaled
        .checked_mul(quote_scale)
        .ok_or(SwapError::InvalidParameters)?;
    let units: u128 = num
        .checked_div(den)
        .ok_or(SwapError::InvalidParameters)?;
    if units == 0 || units > (u64::MAX as u128) {
        return Err(SwapError::InvalidParameters.into());
    }
    Ok(units as u64)
}

// ---
// Price and formula explanation
//
// Inputs
// - quote_units: amount of quote that the user pays, expressed in the quote token's
//   smallest units (i.e. already multiplied by 10^quote_decimals). This is the on-chain
//   natural representation of token amounts.
// - base_decimals / quote_decimals: the number of decimal places for the base and quote
//   mints, respectively.
// - price_scaled: a fixed-point price of 1 base token in terms of quote tokens, where
//   the price is scaled by 1e9 (B = 1_000_000_000). Concretely, if the human price is
//   P (quote per base, after applying token decimals), then price_scaled = round(P * B).
//
// Goal
// - Compute base_units, the amount of base to give the user, expressed in the base token's
//   smallest units (i.e. multiplied by 10^base_decimals), using safe integer arithmetic.
//
// Derivation
// - Let B = 1e9 (the fixed price scale).
// - Let qb = 10^quote_decimals, bb = 10^base_decimals.
// - Let q be the human amount of quote tokens, and Q = q * qb = quote_units the on-chain units.
// - Let p be the human price (quote per base), and price_scaled = p * B.
// - Let x be the human amount of base to output, and X = x * bb = base_units the on-chain units.
//
// From the definition of price: q = p * x  =>  Q/qb = (price_scaled/B) * X/bb
// Rearranging for X yields:
//   X = (Q * bb * B) / (price_scaled * qb)
// which is exactly what the function computes with checked u128 arithmetic:
//   numerator   = quote_units * 10^base_decimals * 1e9
//   denominator = price_scaled * 10^quote_decimals
//   base_units  = numerator / denominator
//
// Properties
// - Precision: Because we multiply by both 10^base_decimals and 1e9 before dividing, we
//   preserve precision until the final division. All intermediate math is u128 with checked
//   operations to avoid overflow and divide-by-zero.
// - Correctness: The formula is a direct rearrangement of q = p * x, accounting for token
//   decimals and the fixed 1e9 scaling used for the price.
// ---


