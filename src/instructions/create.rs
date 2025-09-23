use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    // pubkey::Pubkey,
    sysvars::rent::Rent,
    ProgramResult,
};
use shank::ShankAccount;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::state::TokenAccount;
use crate::{
    errors::SwapError,
    states::{
        utils::{load_ix_data, DataLen},
        SwapState,
    },
};

#[repr(C, packed)]
#[derive(Clone, Copy, Debug, PartialEq, ShankAccount)]
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
    // log!("Decoding CreateData: len expected {}, len actual {}", CreateData::LEN, data.len());
    let ix_data = unsafe { load_ix_data::<CreateData>(data)? };
    // log!("uuid: {} bump: {} price: {}", ix_data.uuid, ix_data.bump_seed, ix_data.price);
    let [owner_acc, swap_acc, base_acc, quote_acc, _system_program, rent_acc] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !owner_acc.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    SwapState::validate_pda(ix_data.bump_seed, ix_data.uuid, swap_acc.key())?;
    if !swap_acc.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let base_token = TokenAccount::from_account_info(base_acc)?;
    let quote_token = TokenAccount::from_account_info(quote_acc)?;
    if base_token.mint() == quote_token.mint() {
        return Err(SwapError::SameMint.into());
    }
    if base_token.owner() != swap_acc.key() {
        return Err(SwapError::WrongOwnerBase.into());
    }
    if quote_token.owner() == swap_acc.key() {
        return Err(SwapError::WrongOwnerQuote.into());
    }
    if ix_data.price == 0 {
        return Err(SwapError::InvalidParameters.into());
    }
    let uuid_binding = ix_data.uuid.to_le_bytes();
    let pda_bump_bytes = [ix_data.bump_seed];
    let signer_seeds = [
        Seed::from(&uuid_binding),
        Seed::from(&pda_bump_bytes[..]),
    ];
    let signers = [Signer::from(&signer_seeds[..])];
    let rent = Rent::from_account_info(rent_acc)?;
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
