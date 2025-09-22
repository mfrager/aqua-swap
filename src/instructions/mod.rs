use pinocchio::program_error::ProgramError;

pub mod initialize;

pub use initialize::*;

#[repr(u8)]
pub enum ProgramInstruction {
    InitializeState,
}

impl TryFrom<&u8> for ProgramInstruction {
    type Error = ProgramError;

    fn try_from(value: &u8) -> Result<Self, Self::Error> {
        match *value {
            0 => Ok(ProgramInstruction::InitializeState),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}