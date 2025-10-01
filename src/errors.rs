use pinocchio::program_error::ProgramError;

#[derive(Clone, PartialEq, shank::ShankType)]
pub enum SwapError {
    // Parameter errors
    InvalidParametersCreatePrice,
    InvalidParametersQuoteInVaultSubtraction,
    InvalidParametersBaseBonusCalculation,
    InvalidParametersQuoteBonusCalculation,
    InvalidParametersBaseBonusOverflow,
    InvalidParametersQuoteBonusOverflow,
    InvalidParametersPriceScaledZero,
    InvalidParametersBaseScaleOverflow,
    InvalidParametersQuoteScaleOverflow,
    InvalidParametersBaseUnitsCalculation,
    InvalidParametersBaseUnitsOverflow,
    InvalidParametersBaseUnitsResult,
    InvalidParametersBaseUnitsResultZero,
    
    // Instruction data errors
    InvalidInstructionDataEntrypointSplit,
    InvalidInstructionDataSwapLength,
    InvalidInstructionDataSwapQuoteInZero,
    InvalidInstructionDataModTryFrom,
    InvalidInstructionDataUtilsLoad,
    
    // Account data errors
    InvalidAccountDataLoadUnchecked,
    InvalidAccountDataLoadMutUnchecked,
    
    // Account validation errors
    NotEnoughAccountKeysCreate,
    NotEnoughAccountKeysSwap,
    NotEnoughAccountKeysClose,
    MissingRequiredSignatureCreate,
    MissingRequiredSignatureSwap,
    MissingRequiredSignatureClose,
    AccountAlreadyInitializedCreate,
    
    // PDA errors
    InvalidPDAValidation,
    
    // Ownership errors
    WrongOwnerBaseCreate,
    WrongOwnerBaseSwapVault,
    WrongOwnerBaseCloseVault,
    WrongOwnerQuoteCreate,
    WrongOwnerQuoteSwapVault,
    
    // Mint errors
    WrongMintBaseCreate,
    WrongMintBaseSwapVaultUser,
    WrongMintBaseSwapVaultMint,
    WrongMintBaseSwapBonus,
    WrongMintBaseClose,
    WrongMintQuoteSwapVaultUser,
    WrongMintQuoteSwapVaultMint,
    WrongMintQuoteSwapSolMint,
    
    // Vault errors
    WrongVaultBaseSwap,
    WrongVaultBaseClose,
    WrongVaultQuoteSwap,
    
    // Other errors
    SameMintCreate,
    NotOwnerClose,
}

impl From<SwapError> for ProgramError {
    fn from(e: SwapError) -> Self {
        Self::Custom(e as u32)
    }
}

