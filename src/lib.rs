#![no_std]

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

#[cfg(feature = "std")]
extern crate std;

pub mod errors;
pub mod instructions;
pub mod states;

pinocchio_pubkey::declare_id!("SWAPmcsgGvfZMoHjp9wSMnGk5S2nVHxCwYAGfta9Vyp");