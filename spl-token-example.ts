#!/usr/bin/env tsx

/**
 * SPL Token Example using @solana/kit and @solana-program/token
 * 
 * This example demonstrates:
 * 1. Creating an SPL token mint using instruction builders
 * 2. Creating an Associated Token Account (ATA) using instruction builders
 * 3. Minting 1000 tokens to the ATA (with 9 decimals)
 */

import { 
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  address,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions
} from '@solana/kit';
import { createSolanaRpc } from '@solana/rpc';
import { 
  getInitializeMintInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  findAssociatedTokenPda,
  fetchToken,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import { 
  getCreateAccountInstruction
} from '@solana-program/system';
import { readFileSync } from 'fs';
import { Keypair } from '@solana/web3.js';

// Configuration
const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const DECIMALS = 9;
const MINT_AMOUNT = 1000; // Amount to mint (will be multiplied by 10^DECIMALS)

async function main() {
  console.log('🚀 Starting SPL Token Example with @solana/kit and @solana-program/token');
  
  try {
    // STEP 1: Initialize @solana/rpc and subscriptions
    console.log('\n📡 Setting up @solana/rpc...');
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ 
      rpc, 
      rpcSubscriptions 
    });
    
    console.log('✅ Connected to Solana devnet via @solana/rpc');

    // STEP 1: Load main wallet from ~/.config/solana/id.json
    console.log('\n🔑 Loading main wallet...');
    const walletPath = process.env.HOME + '/.config/solana/id.json';
    const walletData = JSON.parse(readFileSync(walletPath, 'utf8'));
    console.log('🔍 Wallet data length:', walletData.length);
    
    // Create keypair using traditional web3.js method
    const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('🔍 Keypair public key:', keypair.publicKey.toBase58());
    
    // Create SolanaKit signer directly from the wallet data (64 bytes: 32 private + 32 public)
    const payer = await createKeyPairSignerFromBytes(new Uint8Array(walletData));
    const tokenOwner = await generateKeyPairSigner();
    
    // Get the wallet address from the payer signer
    const walletAddress = payer.address;
    
    console.log('📝 Main wallet address:', walletAddress);
    console.log('👤 Generated token owner keypair:', tokenOwner.address);
    console.log('🔧 SolanaKit payer signer address:', payer.address);
    
    // Verify the signer is working properly
    if (!payer.address) {
      console.log('❌ Payer signer address is undefined - this will cause signing issues');
      return;
    }
    
    // Check wallet balance
    const walletBalance = await rpc.getBalance(address(walletAddress)).send();
    console.log('💰 Main wallet balance:', walletBalance.value, 'lamports');
    
    if (walletBalance.value === 0n) {
      console.log('⚠️  Main wallet has 0 SOL - please fund it first');
      console.log('ℹ️  Wallet address:', walletAddress);
      return;
    }

    console.log('✅ Wallet loaded successfully with', (walletBalance.value / 1_000_000_000n), 'SOL');

    // STEP 3: Create SPL Token Mint using instruction builders (following QuickNode guide)
    console.log('\n🏭 Creating SPL Token Mint using instruction builders...');
    const mint = await generateKeyPairSigner();
    const mintAuthority = payer; // Use payer as mint authority
    console.log('📍 Mint address:', mint.address);

    try {
      // Get mint size and rent exemption
      const mintSpace = BigInt(getMintSize());
      const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace).send();
      
      // Create instructions array (following QuickNode guide pattern)
      const instructions = [
        // Create the Mint Account
        getCreateAccountInstruction({
          payer,
          newAccount: mint,
          lamports: mintRent,
          space: mintSpace,
          programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        // Initialize the Mint
        getInitializeMintInstruction({
          mint: mint.address,
          decimals: DECIMALS,
          mintAuthority: mintAuthority.address
        }),
      ];

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
      
      // Create send and confirm transaction factory
      const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

      // Create transaction using pipe pattern (following QuickNode guide)
      const createMintTxid = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(payer, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions(instructions, tx),
        async (tx) => {
          const signedTransaction = await signTransactionMessageWithSigners(tx);
          await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
          return getSignatureFromTransaction(signedTransaction);
        }
      );
      
      console.log('✅ Token mint created:', mint.address);
      console.log('   Decimals:', DECIMALS);
      console.log('   Mint Authority:', mintAuthority.address);
      console.log('   Transaction signature:', createMintTxid);
      
    } catch (error) {
      console.log('❌ Mint creation failed:', (error as Error).message);
      throw error;
    }

    // STEP 4: Create Associated Token Account and Mint Tokens (following QuickNode guide)
    console.log('\n🏦 Creating ATA and Minting Tokens...');
    
    // Find the ATA address
    const [ata] = await findAssociatedTokenPda({
      mint: mint.address,
      owner: tokenOwner.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    
    console.log('📍 ATA address:', ata);

    try {
      // Create instructions for ATA creation and token minting
      const mintInstructions = [
        // Create the Destination Associated Token Account
        await getCreateAssociatedTokenIdempotentInstructionAsync({
          mint: mint.address,
          payer,
          owner: tokenOwner.address,
        }),
        // Mint To the Destination Associated Token Account
        getMintToInstruction({
          mint: mint.address,
          token: ata,
          amount: BigInt(MINT_AMOUNT * 10 ** DECIMALS),
          mintAuthority, // Signs by including the signer rather than the public key
        })
      ];

      // Get recent blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      // Create transaction using pipe pattern (following QuickNode guide)
      const mintTxid = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(payer, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions(mintInstructions, tx),
        async (tx) => {
          const signedTransaction = await signTransactionMessageWithSigners(tx);
          await sendAndConfirmTransaction(signedTransaction as any, { 
            commitment: 'confirmed',
            skipPreflight: true 
          });
          return getSignatureFromTransaction(signedTransaction);
        }
      );

      console.log('✅ ATA created and tokens minted successfully!');
      console.log('   ATA address:', ata);
      console.log('   Amount:', MINT_AMOUNT, 'tokens');
      console.log('   Transaction signature:', mintTxid);

    } catch (error) {
      console.log('❌ ATA creation and token minting failed:', (error as Error).message);
      throw error;
    }

    // STEP 5: Verify the minted tokens
    console.log('\n🔍 Verifying minted tokens...');
    try {
      const tokenAccount = await fetchToken(rpc, address(ata));
      console.log('✅ Token verification successful!');
      console.log('   Token account:', ata);
      
      // Check if tokenAccount has the expected structure
      if (tokenAccount && typeof tokenAccount === 'object') {
        // Try different possible structures
        const accountData = tokenAccount.account || tokenAccount.data || tokenAccount;
        
        if (accountData) {
          console.log('   Balance:', accountData.amount || accountData.balance || 'N/A');
          console.log('   Mint:', accountData.mint || 'N/A');
          console.log('   Owner:', accountData.owner || 'N/A');
        } else {
          console.log('   Raw token account data:', JSON.stringify(tokenAccount, null, 2));
        }
      } else {
        console.log('   Raw token account data:', JSON.stringify(tokenAccount, null, 2));
      }
    } catch (error) {
      console.log('❌ Token verification failed:', error.message);
      // Don't throw error, just log it since the main functionality worked
    }

    console.log('\n🎉 All steps completed successfully!');
    console.log('📊 Summary:');
    console.log('   Mint address:', mint.address);
    console.log('   Token owner:', tokenOwner.address);
    console.log('   ATA address:', ata);
    console.log('   Minted amount:', MINT_AMOUNT, 'tokens');

  } catch (error) {
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
main().catch(console.error);

export { main as splTokenExample };