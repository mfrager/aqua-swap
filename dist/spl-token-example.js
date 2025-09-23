#!/usr/bin/env tsx
/**
 * SPL Token Example using @solana/kit and @solana/spl-token
 *
 * This example demonstrates:
 * 1. Creating an SPL token mint
 * 2. Creating an Associated Token Account (ATA)
 * 3. Minting 1000 tokens to the ATA (with 9 decimals)
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, createAssociatedTokenAccount, mintTo, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { SolanaKit } from '@solana/kit';
// Configuration
const RPC_URL = 'https://api.devnet.solana.com'; // Using devnet for testing
const DECIMALS = 9;
const MINT_AMOUNT = 1000; // Amount to mint (will be multiplied by 10^DECIMALS)
async function main() {
    console.log('🚀 Starting SPL Token Example with @solana/kit and @solana/spl-token');
    try {
        // Initialize connection
        const connection = new Connection(RPC_URL, 'confirmed');
        console.log('✅ Connected to Solana devnet');
        // Initialize SolanaKit
        const kit = new SolanaKit({
            connection,
            commitment: 'confirmed'
        });
        // Generate a new keypair for the payer (mint authority)
        const payer = Keypair.generate();
        console.log('📝 Generated payer keypair:', payer.publicKey.toString());
        // Generate a new keypair for the token owner
        const tokenOwner = Keypair.generate();
        console.log('👤 Generated token owner keypair:', tokenOwner.publicKey.toString());
        // Request airdrop for the payer to cover transaction fees
        console.log('💰 Requesting airdrop for payer...');
        const airdropSignature = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL // 2 SOL
        );
        await connection.confirmTransaction(airdropSignature);
        console.log('✅ Airdrop confirmed');
        // Step 1: Create SPL Token Mint
        console.log('\n🏭 Creating SPL Token Mint...');
        const mint = await createMint(connection, payer, // payer
        payer.publicKey, // mint authority
        payer.publicKey, // freeze authority (can be null)
        DECIMALS // decimals
        );
        console.log('✅ Token mint created:', mint.toString());
        console.log('   Decimals:', DECIMALS);
        console.log('   Mint Authority:', payer.publicKey.toString());
        // Step 2: Create Associated Token Account (ATA)
        console.log('\n🏦 Creating Associated Token Account...');
        const associatedTokenAddress = await getAssociatedTokenAddress(mint, // mint
        tokenOwner.publicKey, // owner
        false // allowOwnerOffCurve
        );
        console.log('📍 ATA address:', associatedTokenAddress.toString());
        // Check if ATA already exists
        let ataExists = false;
        try {
            await getAccount(connection, associatedTokenAddress);
            ataExists = true;
            console.log('ℹ️  ATA already exists');
        }
        catch (error) {
            console.log('ℹ️  ATA does not exist, creating...');
        }
        if (!ataExists) {
            const createAtaTx = await createAssociatedTokenAccount(payer, // payer
            payer, // payer (same as payer for simplicity)
            tokenOwner.publicKey, // owner
            mint // mint
            );
            console.log('✅ ATA created');
        }
        // Step 3: Mint tokens to the ATA
        console.log('\n🪙 Minting tokens to ATA...');
        const mintAmount = MINT_AMOUNT * Math.pow(10, DECIMALS); // Convert to smallest unit
        console.log(`   Minting ${MINT_AMOUNT} tokens (${mintAmount} smallest units)`);
        const mintSignature = await mintTo(connection, payer, // payer
        mint, // mint
        associatedTokenAddress, // destination (ATA)
        payer, // authority (mint authority)
        mintAmount // amount
        );
        console.log('✅ Tokens minted successfully');
        console.log('   Transaction signature:', mintSignature);
        // Verify the minted tokens
        console.log('\n🔍 Verifying token balance...');
        const tokenAccount = await getAccount(connection, associatedTokenAddress);
        console.log('✅ Token account verified:');
        console.log('   Address:', tokenAccount.address.toString());
        console.log('   Owner:', tokenAccount.owner.toString());
        console.log('   Mint:', tokenAccount.mint.toString());
        console.log('   Balance:', tokenAccount.amount.toString());
        console.log('   Decimals:', tokenAccount.mint.toString());
        // Convert balance back to human-readable format
        const humanReadableBalance = Number(tokenAccount.amount) / Math.pow(10, DECIMALS);
        console.log('   Human-readable balance:', humanReadableBalance, 'tokens');
        // Summary
        console.log('\n📊 Summary:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎯 Token Mint:', mint.toString());
        console.log('👤 Token Owner:', tokenOwner.publicKey.toString());
        console.log('🏦 ATA Address:', associatedTokenAddress.toString());
        console.log('💰 Minted Amount:', MINT_AMOUNT, 'tokens');
        console.log('🔢 Decimals:', DECIMALS);
        console.log('📝 Transaction:', mintSignature);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    catch (error) {
        console.error('❌ Error occurred:', error);
        if (error instanceof Error) {
            console.error('   Message:', error.message);
            if (error.stack) {
                console.error('   Stack:', error.stack);
            }
        }
        process.exit(1);
    }
}
// Run the example
if (require.main === module) {
    main().catch(console.error);
}
export { main as splTokenExample };
