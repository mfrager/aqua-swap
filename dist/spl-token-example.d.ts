#!/usr/bin/env tsx
/**
 * SPL Token Example using @solana/kit and @solana/spl-token
 *
 * This example demonstrates:
 * 1. Creating an SPL token mint
 * 2. Creating an Associated Token Account (ATA)
 * 3. Minting 1000 tokens to the ATA (with 9 decimals)
 */
declare function main(): Promise<void>;
export { main as splTokenExample };
