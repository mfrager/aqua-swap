use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{
    instructions::CloseAccount,
    state::TokenAccount,
};
use crate::{
    errors::SwapError,
    states::{
        utils::load_acc_unchecked,
        SwapState,
    },
};

pub fn close(accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    log!("Close Swap");
    let [owner_acc, swap_acc, vault_base_acc, owner_base_acc, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Validate owner is signer
    if !owner_acc.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load and validate swap state
    let swap_state = unsafe { load_acc_unchecked::<SwapState>(swap_acc.borrow_data_unchecked()) }?;
    
    // Validate owner matches
    if swap_state.owner != *owner_acc.key() {
        return Err(SwapError::NotOwner.into());
    }

    // Validate vault base account matches
    if swap_state.base != *vault_base_acc.key() {
        return Err(SwapError::WrongVaultBase.into());
    }

    // Load vault base token account and extract needed values
    let vault_base_token = TokenAccount::from_account_info(vault_base_acc)?;
    let vault_mint = *vault_base_token.mint();
    let vault_owner = *vault_base_token.owner();
    let transfer_amount = vault_base_token.amount();
    
    // Load owner base token account and extract needed values
    let owner_base_token = TokenAccount::from_account_info(owner_base_acc)?;
    let owner_mint = *owner_base_token.mint();
    
    // Drop the token account structs to release borrows
    drop(vault_base_token);
    drop(owner_base_token);

    // Validate token accounts
    if vault_mint != owner_mint {
        return Err(SwapError::WrongMintBase.into());
    }

    if vault_owner != *swap_acc.key() {
        return Err(SwapError::WrongOwnerBase.into());
    }

    // If there are tokens to transfer, do the transfer
    if transfer_amount > 0 {
        // log!("Transferring {} base tokens back to owner", transfer_amount);
        
        // Create PDA seeds for signing
        let uuid_binding = swap_state.uuid.to_le_bytes();
        let pda_bump_bytes = [swap_state.bump_seed];
        let signer_seeds = [
            Seed::from(&uuid_binding),
            Seed::from(&pda_bump_bytes[..]),
        ];
        let signers = [Signer::from(&signer_seeds[..])];

        // Transfer all tokens from vault to owner
        pinocchio_token::instructions::Transfer {
            from: vault_base_acc,
            to: owner_base_acc,
            authority: swap_acc,
            amount: transfer_amount,
        }
        .invoke_signed(&signers)?;
    }
    
    // Create PDA seeds for signing the close operation
    let uuid_binding = swap_state.uuid.to_le_bytes();
    let pda_bump_bytes = [swap_state.bump_seed];
    let signer_seeds = [
        Seed::from(&uuid_binding),
        Seed::from(&pda_bump_bytes[..]),
    ];
    let signers = [Signer::from(&signer_seeds[..])];

    // Close the vault token account
    CloseAccount {
        account: vault_base_acc,
        destination: owner_acc,
        authority: swap_acc,
    }
    .invoke_signed(&signers)?;
    
    // Transfer remaining lamports from swap account to owner
    let swap_lamports = unsafe { *swap_acc.borrow_lamports_unchecked() };
    if swap_lamports > 0 {
        unsafe {
            *swap_acc.borrow_mut_lamports_unchecked() -= swap_lamports;
            *owner_acc.borrow_mut_lamports_unchecked() += swap_lamports;
        }
    }

    // Clear the swap account data
    unsafe {
        let data = swap_acc.borrow_mut_data_unchecked();
        data.fill(0);
    }

    log!("Swap Closed");
    Ok(())
}
