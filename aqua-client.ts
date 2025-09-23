#!/usr/bin/env tsx

/**
 * Minimal Aqua Swap client using @solana/kit and generated clients.
 * - Connects to devnet
 * - Loads default keypair from ~/.config/solana/id.json
 * - Sends one create() instruction to the Aqua Swap program
 */

import {
  createSolanaRpc,
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
import { readFileSync } from 'fs';
import { Keypair } from '@solana/web3.js';
import { v4 as uuidv4, parse as uuidParse } from 'uuid';
import { toBigIntLE } from 'bigint-buffer';
import {
  getInitializeMintInstruction,
  getMintSize,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import { getCreateAccountInstruction } from '@solana-program/system';

// Generated client imports
import { getCreateInstruction } from './clients/js/src/generated/instructions/create';
import { AQUA_SWAP_PROGRAM_ADDRESS } from './clients/js/src/generated/programs/aquaSwap';

// Optional: program import (not required since instruction includes programAddress by default)
// import { AQUA_SWAP_PROGRAM_ADDRESS } from './clients/js/src/generated/programs';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const DECIMALS = 9;
const MINT_AMOUNT = 1000;

async function main() {
  console.log('🚀 Aqua Swap minimal client start');

  // RPC setup
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  console.log('✅ Connected to Solana devnet');

  // Load payer from ~/.config/solana/id.json and create signer
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletData = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
  const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(walletData));
  console.log('📝 Payer:', payer.address);

  // ------------------------------------------------------------------
  // Derive Swap PDA using a random UUID string and reliable conversions
  // ------------------------------------------------------------------
  const uuidStr = uuidv4();
  const uuidBytes = uuidParse(uuidStr); // Uint8Array(16)
  const uuid = toBigIntLE(Buffer.from(uuidBytes));
  console.log('🆔 UUID (string):', uuidStr);
  console.log('🔢 UUID (u128 bigint):', uuid);

  const [derivedSwapAddress, bumpSeed] = await getProgramDerivedAddress({
    programAddress: AQUA_SWAP_PROGRAM_ADDRESS,
    seeds: [uuidBytes],
  });
  console.log('📍 Derived Swap PDA:', derivedSwapAddress);
  console.log('🧷 Bump seed:', bumpSeed);

  // ------------------------------------------------------------------
  // Create BASE mint and its ATA owned by the swap PDA, then mint 1000
  // ------------------------------------------------------------------
  const baseMint = await generateKeyPairSigner();
  console.log('\n🏭 Creating BASE mint:', baseMint.address);
  const baseMintSize = BigInt(getMintSize());
  const baseMintRent = await rpc.getMinimumBalanceForRentExemption(baseMintSize).send();
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const instructions = [
      getCreateAccountInstruction({
        payer,
        newAccount: baseMint,
        lamports: baseMintRent,
        space: baseMintSize,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMintInstruction({
        mint: baseMint.address,
        decimals: DECIMALS,
        mintAuthority: payer.address,
      }),
    ];
    console.log('🧾 BASE mint rent (lamports):', baseMintRent.toString());
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
    console.log('✅ BASE mint created:', baseMint.address);
  }
  const [baseAta] = await findAssociatedTokenPda({
    mint: baseMint.address,
    owner: derivedSwapAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  console.log('🏦 Creating BASE ATA for swap PDA owner:', baseAta);
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const createBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: baseMint.address,
      payer,
      owner: derivedSwapAddress,
    });
    const mintBaseToIx = getMintToInstruction({
      mint: baseMint.address,
      token: baseAta,
      amount: BigInt(MINT_AMOUNT) * BigInt(10 ** DECIMALS),
      mintAuthority: payer.address,
    });
    console.log('🪙 Minting BASE amount:', MINT_AMOUNT, 'tokens to', baseAta);
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createBaseAtaIx, mintBaseToIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
    console.log('✅ BASE ATA created and funded');
  }

  // ------------------------------------------------------------------
  // Create QUOTE mint and its ATA owned by the user (no minting)
  // ------------------------------------------------------------------
  const quoteMint = await generateKeyPairSigner();
  console.log('\n🏭 Creating QUOTE mint:', quoteMint.address);
  const quoteMintSize = BigInt(getMintSize());
  const quoteMintRent = await rpc.getMinimumBalanceForRentExemption(quoteMintSize).send();
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const instructions = [
      getCreateAccountInstruction({
        payer,
        newAccount: quoteMint,
        lamports: quoteMintRent,
        space: quoteMintSize,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMintInstruction({
        mint: quoteMint.address,
        decimals: DECIMALS,
        mintAuthority: payer.address,
      }),
    ];
    console.log('🧾 QUOTE mint rent (lamports):', quoteMintRent.toString());
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
    console.log('✅ QUOTE mint created:', quoteMint.address);
  }
  const [userQuoteAta] = await findAssociatedTokenPda({
    mint: quoteMint.address,
    owner: payer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  console.log('🏦 Creating QUOTE ATA for user:', userQuoteAta);
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const createUserQuoteAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: quoteMint.address,
      payer,
      owner: payer.address,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createUserQuoteAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
    console.log('✅ QUOTE ATA created (no minting)');
  }

  // Create instruction args using baseAta as vaultBaseAcc and userQuoteAta as vaultQuoteAcc
  const createIx = getCreateInstruction({
    ownerAcc: payer,
    swapAcc: address(derivedSwapAddress),
    vaultBaseAcc: address(baseAta),
    vaultQuoteAcc: address(userQuoteAta),
    createData: {
      uuid,              // u128 from parsed UUID string
      price: 1_000_000n, // u64 (example)
      bumpSeed: Number(bumpSeed) // u8 bump from PDA derivation
    }
  });

  // Blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build, sign and send
  const sig = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createIx], tx),
    async (tx) => {
      const signed = await signTransactionMessageWithSigners(tx);
      await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
      return getSignatureFromTransaction(signed);
    }
  );

  console.log('✅ Sent create() instruction');
  console.log('   Tx signature:', sig);
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});

export { main as aquaClient };


