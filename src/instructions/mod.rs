use pinocchio::program_error::ProgramError;

pub mod create;
pub mod swap;
pub mod close;

pub use create::*;
pub use swap::*;
pub use close::*;

#[repr(u8)]
pub enum SwapProgramInstruction {
    Create,
    Swap,
    Close,
}

impl TryFrom<&u8> for SwapProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match *value {
            0 => Ok(SwapProgramInstruction::Create),
            1 => Ok(SwapProgramInstruction::Swap),
            2 => Ok(SwapProgramInstruction::Close),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

mod idl_gen {
    use super::{
        CreateData,
        SwapData,
    };

    #[derive(shank::ShankInstruction)]
    enum _SwapProgramInstruction {
        #[account(0, writable, signer, name = "owner_acc", desc = "Owner account")]
        #[account(1, name = "verify_acc", desc = "Verify account")]
        #[account(2, writable, name = "swap_acc", desc = "Swap account")]
        #[account(3, name = "vault_base_acc", desc = "Base vault")]
        #[account(4, name = "vault_quote_acc", desc = "Quote vault")]
        #[account(5, name = "system_program")]
        #[account(6, name = "rent")]
        Create(CreateData),
        #[account(0, writable, signer, name = "user_acc", desc = "User account")]
        #[account(1, name = "swap_acc", desc = "Swap account")]
        #[account(2, writable, name = "vault_base_acc", desc = "Base vault")]
        #[account(3, writable, name = "vault_quote_acc", desc = "Quote vault")]
        #[account(4, writable, name = "user_base_acc", desc = "User base token")]
        #[account(5, writable, name = "user_quote_acc", desc = "User quote token")]
        #[account(6, name = "base_mint_acc", desc = "Base mint")]
        #[account(7, name = "quote_mint_acc", desc = "Quote mint")]
        #[account(8, writable, name = "bonus_base_acc", desc = "Bonus base token")]
        #[account(9, writable, name = "bonus_quote_acc", desc = "Bonus quote token or account")]
        #[account(10, writable, name = "wsol_temp_acc", desc = "WSOL temporary token")]
        #[account(11, name = "token_program")]
        #[account(12, name = "system_program")]
        Swap(SwapData),
        #[account(0, writable, signer, name = "owner_acc", desc = "Owner account")]
        #[account(1, writable, name = "swap_acc", desc = "Swap account")]
        #[account(2, writable, name = "vault_base_acc", desc = "Base vault")]
        #[account(3, writable, name = "owner_base_acc", desc = "Owner base token")]
        #[account(4, name = "token_program")]
        Close,
    }
}
