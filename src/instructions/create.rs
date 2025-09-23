use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    // pubkey::Pubkey,
    sysvars::rent::Rent,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
    // errors::SwapError,
    states::{
        utils::{load_ix_data, DataLen},
        SwapState,
    },
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CreateData {
    pub uuid: u128,
    pub price: u64,
    pub bump_seed: u8,
}

impl DataLen for CreateData {
    const LEN: usize = core::mem::size_of::<CreateData>();
}

pub fn create(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    log!("Starting Aqua Swap");
    let [owner_acc, swap_acc, base_acc, quote_acc, _system_program, rent_acc] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !owner_acc.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !swap_acc.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let rent = Rent::from_account_info(rent_acc)?;
    let ix_data = unsafe { load_ix_data::<CreateData>(data)? };
    /* if ix_data.owner.ne(payer_acc.key()) {
        return Err(MyProgramError::InvalidOwner.into());
    } */
    SwapState::validate_pda(ix_data.bump_seed, ix_data.uuid, swap_acc.key())?;
    let uuid_binding = ix_data.uuid.to_le_bytes();
    let pda_bump_bytes = [ix_data.bump_seed];
    let signer_seeds = [
        Seed::from(&uuid_binding),
        Seed::from(&pda_bump_bytes[..]),
    ];
    let signers = [Signer::from(&signer_seeds[..])];
    CreateAccount {
        from: owner_acc,
        to: swap_acc,
        space: SwapState::LEN as u64,
        owner: &crate::ID,
        lamports: rent.minimum_balance(SwapState::LEN),
    }
    .invoke_signed(&signers)?;
    SwapState::create_swap(swap_acc, owner_acc, base_acc, quote_acc, ix_data)?;
    log!("Created Swap Data Account");
    Ok(())
}
