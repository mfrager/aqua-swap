use super::utils::{load_acc_mut_unchecked, DataLen};
use shank::ShankAccount;
use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{errors::SwapError, instructions::CreateData};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, ShankAccount)]
pub struct SwapState {
    pub owner: Pubkey,
    pub base: Pubkey,
    pub quote: Pubkey,
    pub uuid: u128,
    pub price: u64,
    pub bump_seed: u8,
}

impl DataLen for SwapState {
    const LEN: usize = core::mem::size_of::<SwapState>();
}

impl SwapState {
    pub fn validate_pda(bump_seed: u8, uuid: u128, pda: &Pubkey) -> Result<(), ProgramError> {
        let derived = pinocchio_pubkey::derive_address(&[&uuid.to_le_bytes()[..]], Some(bump_seed), &crate::ID);
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
    ) -> ProgramResult {
        let swap_data = unsafe { load_acc_mut_unchecked::<SwapState>(swap_acc.borrow_mut_data_unchecked()) }?;
        swap_data.price = create_data.price;
        swap_data.uuid = create_data.uuid;
        swap_data.bump_seed = create_data.bump_seed;
        swap_data.owner = *owner_acc.key();
        swap_data.base = *base_acc.key();
        swap_data.quote = *quote_acc.key();
        Ok(())
    }
}
