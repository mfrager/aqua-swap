#!/usr/bin/env tsx

/**
 * Aqua Swap Examples - Modular implementation with different price scenarios
 * 
 * This script demonstrates the Aqua Swap program with three different price scenarios:
 * 1. Price = 1 (1:1 exchange rate)
 * 2. Price > 1 (expensive base token, cheap quote token)
 * 3. Price < 1 (cheap base token, expensive quote token)
 */

import {
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  address,
  getProgramDerivedAddress,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  pipe
} from '@solana/kit';
import { createSolanaRpc } from '@solana/rpc';
import { readFileSync } from 'fs';
import { Keypair } from '@solana/web3.js';
import { v4 as uuidv4, parse as uuidParse } from 'uuid';
import { toBigIntLE } from 'bigint-buffer';
import bs58 from 'bs58';
import {
  getInitializeMintInstruction,
  getMintSize,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken
} from '@solana-program/token';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';

// Generated client imports
import { getCreateInstruction } from './clients/js/src/generated/instructions/create';
import { getSwapInstruction } from './clients/js/src/generated/instructions/swap';
import { AQUA_SWAP_PROGRAM_ADDRESS } from './clients/js/src/generated/programs/aquaSwap';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const DECIMALS = 9;
const FUNDING_AMOUNT = 0.5; // SOL to send to new keypair
const SWAP_QUOTE_AMOUNT = 100; // Amount of quote tokens to mint for swapping

// Configuration interface for the swap subroutine
interface SwapConfig {
  price: number;           // Price of 1 base token in quote tokens (scaled by 1e9)
  baseTokensToMint: number; // Amount of base tokens to mint to vault
  quoteTokensToMint: number; // Amount of quote tokens to mint to swap user
  swapAmount: number;      // Amount of quote tokens to swap
  description: string;     // Description of this price scenario
}

// Result interface for the swap subroutine
interface SwapResult {
  success: boolean;
  swapPda: string;
  baseMint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
  swapUser: string;
  swapUserBaseAta: string;
  swapUserQuoteAta: string;
  swapTransactionSignature: string;
  expectedBaseTokens: number;
  actualBaseTokens: number;
  error?: string;
}

/**
 * Main Aqua Swap subroutine - creates a complete swap scenario
 */
async function createAquaSwap(config: SwapConfig): Promise<SwapResult> {
  console.log(`\n🚀 Starting Aqua Swap: ${config.description}`);
  const actualPrice = config.price / 1e9;
  console.log(`   Price: ${actualPrice} (1 base token = ${actualPrice} quote tokens)`);
  console.log(`   Base tokens to mint: ${config.baseTokensToMint}`);
  console.log(`   Quote tokens to mint: ${config.quoteTokensToMint}`);
  console.log(`   Swap amount: ${config.swapAmount} quote tokens`);

  try {
    // RPC setup
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    // Load payer from ~/.config/solana/id.json and create signer
    const walletPath = process.env.HOME + '/.config/solana/id.json';
    const walletData = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
    const payer = await createKeyPairSignerFromBytes(new Uint8Array(walletData));

    // Derive Swap PDA using a random UUID string
    const uuidStr = uuidv4();
    const uuidBytes = uuidParse(uuidStr);
    const uuid = toBigIntLE(Buffer.from(uuidBytes));
    const [derivedSwapAddress, bumpSeed] = await getProgramDerivedAddress({
      programAddress: AQUA_SWAP_PROGRAM_ADDRESS,
      seeds: [uuidBytes],
    });

    // Create BASE mint
    const baseMint = await generateKeyPairSigner();
    const baseMintAuthority = payer;
    
    const baseMintSpace = BigInt(getMintSize());
    const baseMintRent = await rpc.getMinimumBalanceForRentExemption(baseMintSpace).send();
    
    const baseMintInstructions = [
      getCreateAccountInstruction({
        payer,
        newAccount: baseMint,
        lamports: baseMintRent,
        space: baseMintSpace,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMintInstruction({
        mint: baseMint.address,
        decimals: DECIMALS,
        mintAuthority: baseMintAuthority.address
      }),
    ];

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const createBaseMintTxid = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(baseMintInstructions, tx),
      async (tx) => {
        const signedTransaction = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signedTransaction);
      }
    );

    // Create QUOTE mint
    const quoteMint = await generateKeyPairSigner();
    const quoteMintAuthority = payer;
    
    const quoteMintSpace = BigInt(getMintSize());
    const quoteMintRent = await rpc.getMinimumBalanceForRentExemption(quoteMintSpace).send();
    
    const quoteMintInstructions = [
      getCreateAccountInstruction({
        payer,
        newAccount: quoteMint,
        lamports: quoteMintRent,
        space: quoteMintSpace,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMintInstruction({
        mint: quoteMint.address,
        decimals: DECIMALS,
        mintAuthority: quoteMintAuthority.address
      }),
    ];

    const { value: latestBlockhash2 } = await rpc.getLatestBlockhash().send();
    const createQuoteMintTxid = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash2, tx),
      (tx) => appendTransactionMessageInstructions(quoteMintInstructions, tx),
      async (tx) => {
        const signedTransaction = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signedTransaction as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signedTransaction);
      }
    );

    // Derive vault account addresses
    const [baseAta] = await findAssociatedTokenPda({
      mint: baseMint.address,
      owner: derivedSwapAddress,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [quoteAta] = await findAssociatedTokenPda({
      mint: quoteMint.address,
      owner: payer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    // Create base vault account and mint base tokens
    const createBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: baseMint.address,
      payer,
      owner: derivedSwapAddress,
    });
    const mintBaseToIx = getMintToInstruction({
      mint: baseMint.address,
      token: baseAta,
      amount: BigInt(config.baseTokensToMint * 10 ** DECIMALS),
      mintAuthority: baseMintAuthority,
    });

    const { value: latestBlockhash3 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash3, tx),
      (tx) => appendTransactionMessageInstructions([createBaseAtaIx, mintBaseToIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: false });
        return getSignatureFromTransaction(signed);
      }
    );

    // Create quote ATA
    const createQuoteAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: quoteMint.address,
      payer,
      owner: payer.address,
    });

    const { value: latestBlockhash4 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash4, tx),
      (tx) => appendTransactionMessageInstructions([createQuoteAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: false });
        return getSignatureFromTransaction(signed);
      }
    );

    // Create swap account
    const createIx = getCreateInstruction({
      ownerAcc: payer,
      swapAcc: address(derivedSwapAddress),
      vaultBaseAcc: address(baseAta),
      vaultQuoteAcc: address(quoteAta),
      createData: {
        uuid,
        price: BigInt(config.price), // Use the config price
        bumpSeed: Number(bumpSeed)
      }
    });

    const { value: latestBlockhash5 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash5, tx),
      (tx) => appendTransactionMessageInstructions([createIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: false });
        return getSignatureFromTransaction(signed);
      }
    );

    // Create new keypair for swap interaction and fund it
    const swapUser = await generateKeyPairSigner();
    
    const transferIx = getTransferSolInstruction({
      source: payer,
      destination: swapUser.address,
      amount: BigInt(FUNDING_AMOUNT * 1e9),
    });
    
    const { value: latestBlockhash6 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash6, tx),
      (tx) => appendTransactionMessageInstructions([transferIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );

    // Create ATAs for the swap user
    const [swapUserBaseAta] = await findAssociatedTokenPda({
      mint: baseMint.address,
      owner: swapUser.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [swapUserQuoteAta] = await findAssociatedTokenPda({
      mint: quoteMint.address,
      owner: swapUser.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const createSwapUserBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: baseMint.address,
      payer,
      owner: swapUser.address,
    });
    const createSwapUserQuoteAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: quoteMint.address,
      payer,
      owner: swapUser.address,
    });

    const { value: latestBlockhash7 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash7, tx),
      (tx) => appendTransactionMessageInstructions([createSwapUserBaseAtaIx, createSwapUserQuoteAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );

    // Mint quote tokens to swap user
    const mintQuoteToSwapUserIx = getMintToInstruction({
      mint: quoteMint.address,
      token: swapUserQuoteAta,
      amount: BigInt(config.quoteTokensToMint * 10 ** DECIMALS),
      mintAuthority: quoteMintAuthority,
    });

    const { value: latestBlockhash8 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash8, tx),
      (tx) => appendTransactionMessageInstructions([mintQuoteToSwapUserIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
        return getSignatureFromTransaction(signed);
      }
    );

    // Execute swap
    const swapAmount = BigInt(config.swapAmount * 10 ** DECIMALS);
    const swapIx = getSwapInstruction({
      userAcc: swapUser,
      swapAcc: address(derivedSwapAddress),
      vaultBaseAcc: address(baseAta),
      vaultQuoteAcc: address(quoteAta),
      userBaseAcc: address(swapUserBaseAta),
      userQuoteAcc: address(swapUserQuoteAta),
      baseMintAcc: address(baseMint.address),
      quoteMintAcc: address(quoteMint.address),
      swapData: {
        quoteIn: swapAmount
      }
    });

    const { value: latestBlockhash9 } = await rpc.getLatestBlockhash().send();
    const swapSig = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(swapUser, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash9, tx),
      (tx) => appendTransactionMessageInstructions([swapIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
        return getSignatureFromTransaction(signed);
      }
    );

    // Calculate expected base tokens
    const expectedBaseTokens = Math.floor((Number(swapAmount) * 10**DECIMALS * 1e9) / (config.price * 1e9 * 10**DECIMALS));

    // Wait and verify results
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    let actualBaseTokens = 0;
    try {
      const tokenAccount = await fetchToken(rpc, swapUserBaseAta);
      if (tokenAccount) {
        const rawAmount = tokenAccount.data?.amount || 0;
        actualBaseTokens = Number(rawAmount) / (10 ** DECIMALS);
      }
    } catch (error) {
      console.log('⚠️  Could not verify swap results:', error);
    }

    const result: SwapResult = {
      success: true,
      swapPda: derivedSwapAddress,
      baseMint: baseMint.address,
      quoteMint: quoteMint.address,
      baseVault: baseAta,
      quoteVault: quoteAta,
      swapUser: swapUser.address,
      swapUserBaseAta,
      swapUserQuoteAta,
      swapTransactionSignature: swapSig,
      expectedBaseTokens,
      actualBaseTokens,
    };

    console.log(`✅ ${config.description} completed successfully!`);
    console.log(`   Swap PDA: ${derivedSwapAddress}`);
    console.log(`   Swap transaction: ${swapSig}`);
    console.log(`   Expected base tokens: ${expectedBaseTokens}`);
    console.log(`   Actual base tokens: ${actualBaseTokens}`);

    return result;

  } catch (error) {
    console.log(`❌ ${config.description} failed:`, error);
    return {
      success: false,
      swapPda: '',
      baseMint: '',
      quoteMint: '',
      baseVault: '',
      quoteVault: '',
      swapUser: '',
      swapUserBaseAta: '',
      swapUserQuoteAta: '',
      swapTransactionSignature: '',
      expectedBaseTokens: 0,
      actualBaseTokens: 0,
      error: (error as Error).message,
    };
  }
}

/**
 * Main function to run all three examples
 */
async function main() {
  console.log('🚀 Aqua Swap Examples - Testing Different Price Scenarios');
  console.log('✅ Connected to Solana devnet');

  // Example 1: Price = 1 (1:1 exchange rate)
  const example1: SwapConfig = {
    price: 1_000_000_000, // 1 base token = 1 quote token (scaled by 1e9)
    baseTokensToMint: 10000,
    quoteTokensToMint: 100,
    swapAmount: 10, // Swap 10 quote tokens
    description: 'Example 1: Price = 1 (1:1 exchange rate)'
  };

  // Example 2: Price > 1 (expensive base token)
  const example2: SwapConfig = {
    price: 5_000_000_000, // 1 base token = 5 quote tokens (scaled by 1e9)
    baseTokensToMint: 10000,
    quoteTokensToMint: 100,
    swapAmount: 10, // Swap 10 quote tokens
    description: 'Example 2: Price = 5 (expensive base token)'
  };

  // Example 3: Price < 1 (cheap base token)
  const example3: SwapConfig = {
    price: 200_000_000, // 1 base token = 0.2 quote tokens (scaled by 1e9)
    baseTokensToMint: 10000,
    quoteTokensToMint: 100,
    swapAmount: 10, // Swap 10 quote tokens
    description: 'Example 3: Price = 0.2 (cheap base token)'
  };

  // Run all examples
  const results: SwapResult[] = [];
  
  results.push(await createAquaSwap(example1));
  results.push(await createAquaSwap(example2));
  results.push(await createAquaSwap(example3));

  // Summary
  console.log('\n📊 SUMMARY OF ALL EXAMPLES:');
  console.log('=' .repeat(80));
  
  results.forEach((result, index) => {
    const exampleNum = index + 1;
    console.log(`\n${exampleNum}. ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (result.success) {
      console.log(`   Swap PDA: ${result.swapPda}`);
      console.log(`   Transaction: ${result.swapTransactionSignature}`);
      console.log(`   Expected base tokens: ${result.expectedBaseTokens}`);
      console.log(`   Actual base tokens: ${result.actualBaseTokens}`);
      console.log(`   Exchange rate: ${result.expectedBaseTokens > 0 ? (10 / result.expectedBaseTokens).toFixed(2) : 'N/A'} quote tokens per base token`);
    } else {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log('\n🎉 All examples completed!');
}

// Run the examples
main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});

export { createAquaSwap, SwapConfig, SwapResult };
