#![no_std]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

#[cfg(feature = "std")]
extern crate std;

pub mod errors;
pub mod instructions;
pub mod states;

pinocchio_pubkey::declare_id!("26iQhBNLcPpV5gQnbCAqLR9m1rY7ZG88Qvmm2yLTKUiQ");