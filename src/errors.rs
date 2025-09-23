use pinocchio::program_error::ProgramError;

#[derive(Clone, PartialEq, shank::ShankType)]
pub enum SwapError {
    InvalidParameters,
    InvalidPDA,
    WrongOwnerBase,
    WrongOwnerQuote,
    WrongMintBase,
    WrongMintQuote,
    WrongVaultBase,
    WrongVaultQuote,
    SameMint,
}

impl From<SwapError> for ProgramError {
    fn from(e: SwapError) -> Self {
        Self::Custom(e as u32)
    }
}

