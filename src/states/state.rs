use super::utils::{load_acc_mut_unchecked, DataLen};
use shank::ShankAccount;
use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;
//use aranya_base58::ToBase58;

use crate::{errors::SwapError, instructions::CreateData};

#[repr(C, packed)]
#[derive(Clone, Copy, Debug, PartialEq, ShankAccount)]
pub struct SwapState {
    pub owner: Pubkey,
    pub base: Pubkey,
    pub quote: Pubkey,
    pub uuid: u128,
    pub price: u64,
    pub bonus_base: u64,
    pub bonus_quote: u64,
    pub bump_seed: u8,
    pub quote_sol: bool,
}

impl DataLen for SwapState {
    const LEN: usize = core::mem::size_of::<SwapState>();
}

impl SwapState {
    pub fn validate_pda(bump_seed: u8, uuid: u128, pda: &Pubkey) -> Result<(), ProgramError> {
        let derived = pinocchio_pubkey::derive_address(&[&uuid.to_le_bytes()[..]], Some(bump_seed), &crate::ID);
        /* let pda_b58 = pda.to_base58();
        log!("Validate PDA expected: {}", pda_b58.as_str());
        let derived_b58 = derived.to_base58();
        log!("Validate PDA derived: {}", derived_b58.as_str()); */
        if derived != *pda {
            return Err(SwapError::InvalidPDA.into());
        }
        Ok(())
    }

    pub fn create_swap(
        swap_acc: &AccountInfo,
        owner_acc: &AccountInfo,
        base_acc: &AccountInfo,
        quote_acc: &AccountInfo,
        create_data: &CreateData,
        quote_sol: bool,
        quote_owner: Pubkey,
    ) -> ProgramResult {
        let swap_data = unsafe { load_acc_mut_unchecked::<SwapState>(swap_acc.borrow_mut_data_unchecked()) }?;
        swap_data.price = create_data.price;
        swap_data.bonus_base = create_data.bonus_base;
        swap_data.bonus_quote = create_data.bonus_quote;
        swap_data.uuid = create_data.uuid;
        swap_data.bump_seed = create_data.bump_seed;
        swap_data.owner = *owner_acc.key();
        swap_data.base = *base_acc.key();
        if quote_sol {
            swap_data.quote = quote_owner;
        } else {
            swap_data.quote = *quote_acc.key();
        }
        swap_data.quote_sol = quote_sol;

        log!("SwapState uuid: {}", swap_data.uuid);
        log!("SwapState quote_sol: {}", swap_data.quote_sol);
        log!("SwapState price: {}", swap_data.price / 1_000_000_000);
        log!("SwapState bonus_base: {}%", swap_data.bonus_base / 1_000_000_000);
        log!("SwapState bonus_quote: {}%", swap_data.bonus_quote / 1_000_000_000);

        Ok(())
    }
}
