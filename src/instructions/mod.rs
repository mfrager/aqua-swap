use pinocchio::program_error::ProgramError;

pub mod create;
// pub mod close;
// pub mod swap;

pub use create::*;
// pub use close::*;
// pub use swap::*;

#[repr(u8)]
pub enum SwapProgramInstruction {
    Create,
    // Close,
    // Swap,
}

impl TryFrom<&u8> for SwapProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match *value {
            0 => Ok(SwapProgramInstruction::Create),
            // 1 => Ok(SwapProgramInstruction::Close),
            // 2 => Ok(SwapProgramInstruction::Swap),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

mod idl_gen {
    use super::{
        CreateData,
        // SwapData,
    };

    #[derive(shank::ShankInstruction)]
    enum _SwapProgramInstruction {
        #[account(0, writable, signer, name = "owner_acc", desc = "Owner account")]
        #[account(1, writable, name = "swap_acc", desc = "Swap account")]
        #[account(2, name = "vault_base_acc", desc = "Base vault")]
        #[account(3, name = "vault_quote_acc", desc = "Quote vault")]
        #[account(4, name = "system_program")]
        #[account(5, name = "rent")]
        Create(CreateData),
/*        #[account(0, writable, signer, name = "owner_acc", desc = "Owner account")]
        #[account(1, writable, name = "swap_acc", desc = "Swap account")]
        #[account(2, writable, name = "vault_base_acc", desc = "Base vault")]
        #[account(3, writable, name = "owner_base_acc", desc = "Owner base token")]
        #[account(4, name = "token_program")]
        Close, */
/*        #[account(0, writable, signer, name = "user_acc", desc = "User account")]
        #[account(1, name = "swap_acc", desc = "Swap account")]
        #[account(2, writable, name = "vault_base_acc", desc = "Base vault")]
        #[account(3, writable, name = "vault_quote_acc", desc = "Quote vault")]
        #[account(4, writable, name = "user_base_acc", desc = "User base token")]
        #[account(5, writable, name = "user_quote_acc", desc = "User quote token")]
        #[account(6, name = "token_program")]
        Swap(SwapData), */
    }
}
