use std::mem;
use mollusk_svm::result::{Check, ProgramResult};
use mollusk_svm::{program, Mollusk};
use solana_sdk::account::Account;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey;
use solana_sdk::pubkey::Pubkey;
extern crate alloc;
use alloc::vec;

use aqua_swap::instructions::create::CreateData;
use aqua_swap::states::to_bytes;
// use aqua_swap::states::DataLen;
use solana_sdk::rent::Rent;
// use solana_sdk::sysvar::Sysvar;

pub const PROGRAM: Pubkey = pubkey!("26iQhBNLcPpV5gQnbCAqLR9m1rY7ZG88Qvmm2yLTKUiQ");

pub const RENT: Pubkey = pubkey!("SysvarRent111111111111111111111111111111111");

pub const PAYER: Pubkey = pubkey!("FzUozk2MPhUfEuNzUZqPTTv1reHPhKqvmFhbBS2ph7R7");

pub fn mollusk() -> Mollusk {
    let mollusk = Mollusk::new(&PROGRAM, "target/deploy/aqua_swap");
    mollusk
}

pub fn get_rent_data() -> Vec<u8> {
    let rent = Rent::default();
    unsafe {
        core::slice::from_raw_parts(&rent as *const Rent as *const u8, mem::size_of::<Rent>()).to_vec()
    }
}

#[test]
fn test_initialize_swap() {
    let mollusk = mollusk();

    //system program and system account
    let (system_program, system_account) = program::keyed_account_for_system_program();

    // Create the PDA
    let uuid: u128 = 1000;
    let uuid_binding = uuid.to_le_bytes();
    let (swap_pda, bump) = Pubkey::find_program_address(&[&uuid_binding[..]], &PROGRAM);

    //Initialize the accounts
    let payer_account = Account::new(1 * LAMPORTS_PER_SOL, 0, &system_program);
    let swap_account = Account::new(0, 0, &system_program);
    let base_account = Account::new(0, 0, &system_program);
    let quote_account = Account::new(0, 0, &system_program);
    let min_balance = mollusk.sysvars.rent.minimum_balance(mem::size_of::<Rent>());
    let mut rent_account = Account::new(min_balance, mem::size_of::<Rent>(), &RENT);
    rent_account.data = get_rent_data();

    //Push the accounts in to the instruction_accounts vec!
    let ix_accounts = vec![
        AccountMeta::new(PAYER, true),
        AccountMeta::new(swap_pda, false),
        AccountMeta::new_readonly(pubkey!("G9GUQuEKS6oJsZspUrAJ1aWFqp1SPq5tgCja4wpMueyX"), false),
        AccountMeta::new_readonly(pubkey!("G9GUQuEKS6oJsZspUrAJ1aWFqp1SPq5tgCja4wpMueyX"), false),
        AccountMeta::new_readonly(system_program, false),
        AccountMeta::new_readonly(RENT, false),
    ];

    // Create the instruction data
    let ix_data = CreateData {
        bump_seed: bump,
        uuid: uuid,
        price: 1,
    };

    // Ix discriminator = 0
    let discrim: u8 = 0;
    let mut ser_ix_data = vec![discrim];

    // print!("CreateData LEN: {}", CreateData::LEN);

    // Serialize the instruction data
    ser_ix_data.extend_from_slice(unsafe { to_bytes(&ix_data) });

    // Create instruction
    let instruction = Instruction::new_with_bytes(PROGRAM, &ser_ix_data, ix_accounts);

    // Create tx_accounts vec
    let tx_accounts = &vec![
        (PAYER, payer_account.clone()),
        (swap_pda, swap_account.clone()),
        (pubkey!("G9GUQuEKS6oJsZspUrAJ1aWFqp1SPq5tgCja4wpMueyX"), base_account.clone()),
        (pubkey!("G9GUQuEKS6oJsZspUrAJ1aWFqp1SPq5tgCja4wpMueyX"), quote_account.clone()),
        (system_program, system_account.clone()),
        (RENT, rent_account.clone()),
    ];

    let init_res = mollusk.process_and_validate_instruction(&instruction, tx_accounts, &[Check::success()]);
    assert!(init_res.program_result == ProgramResult::Success);
}
        
