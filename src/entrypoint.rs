#![allow(unexpected_cfgs)]

use crate::instructions::{self, SwapProgramInstruction};
use pinocchio::{
    account_info::AccountInfo, default_panic_handler, no_allocator, program_entrypoint,
    program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};
// use pinocchio_log::log;

// This is the entrypoint for the program.
program_entrypoint!(process_instruction);
//Do not allocate memory.
no_allocator!();
// Use the no_std panic handler.
default_panic_handler!();

#[inline(always)]
fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    pinocchio_log::log!("Entrypoint: instruction_data len = {}", instruction_data.len());
    let (ix_disc, instruction_data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    pinocchio_log::log!("Entrypoint: discriminator = {}", *ix_disc as u32);
    match SwapProgramInstruction::try_from(ix_disc)? {
        SwapProgramInstruction::Create => {
            pinocchio_log::log!("Entrypoint: calling create");
            instructions::create(accounts, instruction_data)
        },
        SwapProgramInstruction::Swap => {
            pinocchio_log::log!("Entrypoint: calling swap");
            instructions::swap(accounts, instruction_data)
        },
        SwapProgramInstruction::Close => {
            pinocchio_log::log!("Entrypoint: calling close");
            instructions::close(accounts, instruction_data)
        },
    }
}
