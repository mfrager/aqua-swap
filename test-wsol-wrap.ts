#!/usr/bin/env tsx

/**
 * Test WSOL wrapping functionality
 */

import {
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
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
import bs58 from 'bs58';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getSyncNativeInstruction,
  getCloseAccountInstruction,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken
} from '@solana-program/token';
import { getTransferSolInstruction } from '@solana-program/system';

// WSOL mint address
const WSOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';

async function main() {
  console.log('🧪 Testing WSOL wrapping functionality');

  // RPC setup
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Load payer
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletData = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(walletData));
  console.log('📝 Payer:', payer.address);

  // Create test user
  const testUser = await generateKeyPairSigner();
  console.log('👤 Test user:', testUser.address);

  // Fund test user
  console.log('💰 Funding test user with 1 SOL...');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transferIx = getTransferSolInstruction({
      source: payer,
      destination: testUser.address,
      amount: BigInt(1 * 1e9), // 1 SOL
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
    console.log('✅ Test user funded');
  }

  // Derive WSOL ATA
  const [wsolAta] = await findAssociatedTokenPda({
    mint: WSOL_MINT_ADDRESS,
    owner: testUser.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  console.log('🏦 WSOL ATA:', wsolAta);

  // Test 1: Create WSOL ATA
  console.log('\n📋 Test 1: Creating WSOL ATA...');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const createWsolAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: WSOL_MINT_ADDRESS,
      payer: testUser,
      owner: testUser.address,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(testUser, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createWsolAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Create WSOL ATA signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ WSOL ATA created');
  }

  // Test 2: Transfer SOL to WSOL ATA
  console.log('\n💰 Test 2: Transferring 0.5 SOL to WSOL ATA...');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transferSolIx = getTransferSolInstruction({
      source: testUser,
      destination: wsolAta,
      amount: BigInt(0.5 * 1e9), // 0.5 SOL
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(testUser, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferSolIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Transfer SOL signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ SOL transferred to WSOL ATA');
  }

  // Test 3: Sync native
  console.log('\n🔄 Test 3: Syncing native WSOL balance...');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const syncNativeIx = getSyncNativeInstruction({
      account: wsolAta,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(testUser, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([syncNativeIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Sync native signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ Native WSOL synced');
  }

  // Check WSOL balance
  console.log('\n🔍 Checking WSOL balance...');
  try {
    const wsolAccount = await fetchToken(rpc, wsolAta);
    if (wsolAccount) {
      const rawAmount = wsolAccount.data.amount || 0;
      const balanceInTokens = Number(rawAmount) / (10 ** 9);
      console.log('💰 WSOL balance:', balanceInTokens, 'WSOL');
      console.log('💰 Raw amount:', rawAmount);
    } else {
      console.log('❌ Could not fetch WSOL account');
    }
  } catch (error) {
    console.log('❌ Error checking WSOL balance:', error);
  }

  // Test 4: Close WSOL ATA
  console.log('\n🔒 Test 4: Closing WSOL ATA...');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const closeWsolAtaIx = getCloseAccountInstruction({
      account: wsolAta,
      destination: testUser.address,
      owner: testUser.address,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(testUser, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([closeWsolAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Close WSOL ATA signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ WSOL ATA closed');
  }

  console.log('\n🎉 WSOL wrapping test completed successfully!');
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
