#!/usr/bin/env python3
"""
Generate a PDA (Program Derived Address) for a given program ID and an optional
UUID. If the UUID is omitted a random 128‑bit value is generated.

The script prints a single comma‑separated line containing:

    <PDA_BASE58>,<BUMP>,<UUID_AS_BIGINT>

Example output:
    9xQ9J2g7Zc5kJ6a7s8VtLx9Xz9Qe6hZL8vK7k3p9F9aB,255,12345678901234567890

Usage:
    python3 create_pda.py --program-id <PROGRAM_ID> [--uuid <UUID>]

    <PROGRAM_ID> : Base58 string of the program's public key.
    <UUID>       : Decimal or hexadecimal representation of a 128‑bit integer.
                  Hex values may be prefixed with "0x". If omitted a random
                  UUID is generated.
"""

import argparse
import secrets
import sys

# Solder's Pubkey implementation
from solders.pubkey import Pubkey


def parse_uuid(uuid_str: str) -> bytes:
    """
    Convert a UUID string (decimal or hex) to a 16‑byte little‑endian representation.
    """
    # Detect hex notation
    if uuid_str.lower().startswith("0x"):
        uuid_int = int(uuid_str, 16)
    else:
        # Try decimal first; if it fails, fallback to hex without 0x
        try:
            uuid_int = int(uuid_str, 10)
        except ValueError:
            uuid_int = int(uuid_str, 16)

    if uuid_int < 0 or uuid_int >= 1 << 128:
        raise ValueError(
            "UUID must fit into an unsigned 128‑bit integer (0 <= uuid < 2^128)."
        )

    return uuid_int.to_bytes(16, byteorder="little")


def random_uuid_bytes() -> bytes:
    """Generate a random 128‑bit integer and return its little‑endian 16‑byte form."""
    rand_int = secrets.randbits(128)
    return rand_int.to_bytes(16, byteorder="little")


def bytes_to_uint128_le(b: bytes) -> int:
    """Convert a 16‑byte little‑endian value to a Python int (bigint)."""
    if len(b) != 16:
        raise ValueError("Expected 16 bytes for a u128 value.")
    return int.from_bytes(b, byteorder="little", signed=False)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a PDA from a program ID and an optional UUID (u128 LE). "
            "Outputs PDA, bump seed, and the UUID as a decimal bigint."
        )
    )
    parser.add_argument(
        "--program-id",
        required=True,
        help="Base58‑encoded program public key.",
    )
    parser.add_argument(
        "--uuid",
        required=False,
        help=(
            "UUID as decimal or hex (e.g. 123456789 or 0x1a2b3c4d5e6f...). "
            "If omitted a random UUID is generated."
        ),
    )
    args = parser.parse_args()

    # ----------------------------------------------------------------------
    # Validate program ID
    # ----------------------------------------------------------------------
    try:
        program_id = Pubkey.from_string(args.program_id)
    except Exception as exc:
        sys.exit(f"Invalid program ID '{args.program_id}': {exc}")

    # ----------------------------------------------------------------------
    # Determine seed bytes (user‑provided or random)
    # ----------------------------------------------------------------------
    if args.uuid:
        try:
            seed_bytes = parse_uuid(args.uuid)
        except Exception as exc:
            sys.exit(f"Invalid UUID '{args.uuid}': {exc}")
    else:
        seed_bytes = random_uuid_bytes()

    # Convert the seed back to a decimal bigint for output
    uuid_bigint = bytes_to_uint128_le(seed_bytes)

    # ----------------------------------------------------------------------
    # Compute PDA and bump seed using Solders
    # ----------------------------------------------------------------------
    # Solders expects a list of byte slices as seeds
    pda, bump = Pubkey.find_program_address([seed_bytes], program_id)

    # ----------------------------------------------------------------------
    # Output: PDA,BUMP,UUID_BIGINT
    # ----------------------------------------------------------------------
    print(f"{pda},{bump},{uuid_bigint}")


if __name__ == "__main__":
    main()

