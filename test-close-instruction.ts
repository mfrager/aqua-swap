#!/usr/bin/env tsx

/**
 * Aqua Swap Close Instruction Test
 * 
 * This script demonstrates how to use the close instruction to:
 * 1. Transfer all remaining base tokens from the vault back to the owner
 * 2. Close the base vault token account
 * 3. Close the swap account itself
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
import { v4 as uuidv4, parse as uuidParse } from 'uuid';
import { toBigIntLE } from 'bigint-buffer';
import {
  getInitializeMintInstruction,
  getMintSize,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken
} from '@solana-program/token';
import { getCreateAccountInstruction } from '@solana-program/system';

// Generated client imports
import { getCreateInstruction } from './clients/js/src/generated/instructions/create';
import { getSwapInstruction } from './clients/js/src/generated/instructions/swap';
import { AQUA_SWAP_PROGRAM_ADDRESS } from './clients/js/src/generated/programs/aquaSwap';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const DECIMALS = 9;
const BASE_TOKENS_TO_MINT = 1000;
const QUOTE_TOKENS_TO_MINT = 100;
const SWAP_AMOUNT = 10;

async function testCloseInstruction() {
  console.log('🚀 Testing Aqua Swap Close Instruction');
  console.log('✅ Connected to Solana devnet');

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

    console.log(`🆔 UUID: ${uuidStr}`);
    console.log(`📦 Swap PDA: ${derivedSwapAddress}`);
    console.log(`🎯 Bump seed: ${bumpSeed}`);

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
    await pipe(
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
    await pipe(
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
      amount: BigInt(BASE_TOKENS_TO_MINT * 10 ** DECIMALS),
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
        price: BigInt(1_000_000_000), // 1 base token = 1 quote token
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

    console.log('✅ Swap account created successfully');

    // Create owner's base token ATA for receiving tokens during close
    const [ownerBaseAta] = await findAssociatedTokenPda({
      mint: baseMint.address,
      owner: payer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const createOwnerBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: baseMint.address,
      payer,
      owner: payer.address,
    });

    const { value: latestBlockhash6 } = await rpc.getLatestBlockhash().send();
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash6, tx),
      (tx) => appendTransactionMessageInstructions([createOwnerBaseAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );

    // Check vault balance before close
    console.log('🔍 Checking vault balance before close...');
    const vaultBeforeClose = await fetchToken(rpc, baseAta);
    if (vaultBeforeClose) {
      const vaultBalance = Number(vaultBeforeClose.data?.amount || 0) / (10 ** DECIMALS);
      console.log(`   Base vault balance: ${vaultBalance} tokens`);
    }

    // Check owner balance before close
    const ownerBeforeClose = await fetchToken(rpc, ownerBaseAta);
    if (ownerBeforeClose) {
      const ownerBalance = Number(ownerBeforeClose.data?.amount || 0) / (10 ** DECIMALS);
      console.log(`   Owner base balance: ${ownerBalance} tokens`);
    }

    // TODO: Add close instruction call here once client code is generated
    console.log('⚠️  Close instruction not yet implemented in client code');
    console.log('   The close instruction would:');
    console.log('   1. Transfer all base tokens from vault to owner');
    console.log('   2. Close the base vault token account');
    console.log('   3. Close the swap account itself');
    console.log('   4. Return lamports to owner');

    console.log('\n🎉 Close instruction test setup completed!');
    console.log('   Swap PDA:', derivedSwapAddress);
    console.log('   Base vault:', baseAta);
    console.log('   Owner base ATA:', ownerBaseAta);

  } catch (error) {
    console.log('❌ Error:', error);
    process.exit(1);
  }
}

// Run the test
testCloseInstruction().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
