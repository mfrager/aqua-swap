use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    // pubkey::Pubkey,
    sysvars::rent::Rent,
    ProgramResult,
};
use five8_const::decode_32_const;
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
    pub bonus_base: u64,
    pub bonus_quote: u64,
    pub bump_seed: u8,
    pub require_verify: bool,
}

impl DataLen for CreateData {
    const LEN: usize = core::mem::size_of::<CreateData>();
}

pub fn create(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    log!("Create Swap");
    // log!("Decoding CreateData: len expected {}, len actual {}", CreateData::LEN, data.len());
    let ix_data = unsafe { load_ix_data::<CreateData>(data)? };
    // log!("uuid: {} bump: {} price: {}", ix_data.uuid, ix_data.bump_seed, ix_data.price);
    log!("Create Swap 2");
    let [
        owner_acc,
        verify_acc,
        swap_acc,
        base_acc,
        quote_acc,
        _system_program,
        rent_acc
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    log!("Create Swap 3");
    if !owner_acc.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    log!("Create Swap 4");
    SwapState::validate_pda(ix_data.bump_seed, ix_data.uuid, swap_acc.key())?;
    log!("Create Swap 4.1");
    if !swap_acc.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    log!("Create Swap 4.2");
    let base_token = TokenAccount::from_account_info(base_acc)?;
    log!("Create Swap 4.3");
    let quote_token = TokenAccount::from_account_info(quote_acc)?;
    log!("Create Swap 4.4");
    if base_token.mint() == quote_token.mint() {
        return Err(SwapError::SameMint.into());
    }
    log!("Create Swap 4.5");
    if base_token.owner() != swap_acc.key() {
        return Err(SwapError::WrongOwnerBase.into());
    }
    log!("Create Swap 4.6");
    if quote_token.owner() == swap_acc.key() {
        return Err(SwapError::WrongOwnerQuote.into());
    }
    log!("Create Swap 4.7");
    if ix_data.price == 0 {
        return Err(SwapError::InvalidParameters.into());
    }
    log!("Create Swap 5");
    let mut quote_sol: bool = false;
    let quote_owner = *quote_token.owner();

    if *quote_token.mint() == decode_32_const("So11111111111111111111111111111111111111112") {
        quote_sol = true;
    }

    log!("Create Swap 6");

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
    log!("Create Swap 7");
    SwapState::create_swap(swap_acc, owner_acc, verify_acc, base_acc, quote_acc, ix_data, quote_sol, quote_owner)?;
    log!("Swap Created");
    Ok(())
}
