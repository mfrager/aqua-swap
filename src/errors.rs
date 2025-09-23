use pinocchio::program_error::ProgramError;

#[derive(Clone, PartialEq, shank::ShankType)]
pub enum SwapError {
    InvalidInstructionData,
    InvalidPDA,
}

impl From<SwapError> for ProgramError {
    fn from(e: SwapError) -> Self {
        Self::Custom(e as u32)
    }
}

