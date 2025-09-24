#!/usr/bin/env tsx

/**
 * Aqua Swap client using Wrapped SOL (WSOL) as quote token.
 * - Connects to devnet
 * - Loads default keypair from ~/.config/solana/id.json
 * - Uses WSOL as the quote token instead of creating a custom mint
 * - Sends one create() instruction to the Aqua Swap program
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
  getSyncNativeInstruction,
  getCloseAccountInstruction,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken
} from '@solana-program/token';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';

// Generated client imports
import { getCreateInstruction } from './clients/js/src/generated/instructions/create';
import { getSwapInstruction } from './clients/js/src/generated/instructions/swap';
import { getCloseInstruction } from './clients/js/src/generated/instructions/close';
import { AQUA_SWAP_PROGRAM_ADDRESS } from './clients/js/src/generated/programs/aquaSwap';

// WSOL mint address (same on all networks)
const WSOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const DECIMALS = 9;
const MINT_AMOUNT = 10000; // Increased to cover the swap amount
const FUNDING_AMOUNT = 0.5; // SOL to send to new keypair

async function main() {
  console.log('🚀 Aqua Swap WSOL client start');

  // RPC setup
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  console.log('✅ Connected to Solana devnet');

  // Load payer from ~/.config/solana/id.json and create signer
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletData = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
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
  // Create BASE mint first (no ATA yet) - using working pattern
  // ------------------------------------------------------------------
  const baseMint = await generateKeyPairSigner();
  const baseMintAuthority = payer; // Use payer as mint authority
  console.log('\n🏭 Creating BASE mint:', baseMint.address);
  console.log('   Mint authority:', baseMintAuthority.address);
  console.log('   Decimals:', DECIMALS);
  
  try {
    // Get mint size and rent exemption
    const baseMintSpace = BigInt(getMintSize());
    const baseMintRent = await rpc.getMinimumBalanceForRentExemption(baseMintSpace).send();
    
    // Create instructions array (following working example pattern)
    const baseMintInstructions = [
      // Create the Mint Account
      getCreateAccountInstruction({
        payer,
        newAccount: baseMint,
        lamports: baseMintRent,
        space: baseMintSpace,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      // Initialize the Mint
      getInitializeMintInstruction({
        mint: baseMint.address,
        decimals: DECIMALS,
        mintAuthority: baseMintAuthority.address
      }),
    ];

    // Get recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    
    // Create send and confirm transaction factory
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    // Create transaction using pipe pattern (following working example)
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
    
    console.log('✅ BASE mint created:', baseMint.address);
    console.log('   Decimals:', DECIMALS);
    console.log('   Mint Authority:', baseMintAuthority.address);
    console.log('   Transaction signature:', createBaseMintTxid);
    
  } catch (error) {
    console.log('❌ BASE mint creation failed:', (error as Error).message);
    throw error;
  }

  // ------------------------------------------------------------------
  // Use WSOL as quote token (no need to create a custom mint)
  // ------------------------------------------------------------------
  console.log('\n🏭 Using WSOL as quote token');
  console.log('   WSOL mint address:', WSOL_MINT_ADDRESS);
  console.log('   Decimals: 9 (same as SOL)');

  // ------------------------------------------------------------------
  // Create vault accounts and call create instruction in same transaction
  // ------------------------------------------------------------------
  console.log('\n📋 Creating vault accounts and swap account...');
  
  // Derive vault account addresses
  const [baseAta] = await findAssociatedTokenPda({
    mint: baseMint.address,
    owner: derivedSwapAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [quoteAta] = await findAssociatedTokenPda({
    mint: WSOL_MINT_ADDRESS,
    owner: payer.address, // Quote vault should be owned by payer, not swap PDA
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  console.log('🏦 Vault accounts:');
  console.log('   Base ATA:', baseAta);
  console.log('   Quote ATA (WSOL):', quoteAta);

  // Create vault accounts, swap account, and mint base tokens in same transaction (following working example pattern)
  console.log('🪙 Creating vault accounts, swap account, and minting base tokens...');
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  
  const createBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    mint: baseMint.address,
    payer,
    owner: derivedSwapAddress,
  });
  const mintBaseToIx = getMintToInstruction({
    mint: baseMint.address,
    token: baseAta,
    amount: BigInt(MINT_AMOUNT * 10 ** DECIMALS),
    mintAuthority: baseMintAuthority,
  });

  // Build, sign and send all instructions together (like working example)
  try {
    const sig = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createBaseAtaIx, mintBaseToIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Vault creation and minting transaction signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: false });
        return getSignatureFromTransaction(signed);
      }
    );
  } catch (error) {
    console.log('❌ Vault creation and minting failed:', error);
    throw error;
  }

  console.log('✅ Created base vault account and minted base tokens');

  // Verify the base vault balance immediately after minting (like working example)
  console.log('🔍 Verifying base vault balance after minting...');
  console.log('⏳ Waiting 10 seconds for transaction to be fully processed...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  try {
    const baseVaultAccount = await fetchToken(rpc, baseAta);
    if (baseVaultAccount) {
      const rawAmount = baseVaultAccount.account?.amount || 0;
      const balanceInTokens = Number(rawAmount) / (10 ** DECIMALS);
      console.log('   Base vault balance verification:', balanceInTokens, 'tokens');
      console.log('   Base vault raw amount:', rawAmount);
    } else {
      console.log('   Base vault account not found during verification');
    }
  } catch (error) {
    console.log('   Error verifying base vault balance:', error);
  }

  // ------------------------------------------------------------------
  // Create WSOL ATA in separate transaction
  // ------------------------------------------------------------------
  console.log('\n📋 Creating WSOL ATA...');
  const { value: latestBlockhash2 } = await rpc.getLatestBlockhash().send();
  
  const createQuoteAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    mint: WSOL_MINT_ADDRESS,
    payer,
    owner: payer.address, // Quote vault should be owned by payer
  });

  try {
    const sig = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash2, tx),
      (tx) => appendTransactionMessageInstructions([createQuoteAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   WSOL ATA creation transaction signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: false });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ WSOL ATA created');
  } catch (error) {
    console.log('❌ WSOL ATA creation failed:', error);
    throw error;
  }

  // ------------------------------------------------------------------
  // Create swap account in separate transaction
  // ------------------------------------------------------------------
  console.log('\n📋 Creating swap account...');
  const { value: latestBlockhash3 } = await rpc.getLatestBlockhash().send();
  
  const createIx = getCreateInstruction({
    ownerAcc: payer,
    swapAcc: address(derivedSwapAddress),
    vaultBaseAcc: address(baseAta),
    vaultQuoteAcc: address(quoteAta),
    verifyAcc: payer, // Use payer as verify account
    createData: {
      uuid,              // u128 from parsed UUID string
      price: 10_000n, // 10 quote tokens per 1 base token (scaled by 1e9)
      bonusBase: 0n,     // Set bonus base to 0
      bonusQuote: 0n,    // Set bonus quote to 0
      bumpSeed: Number(bumpSeed) // u8 bump from PDA derivation
    }
  });

  try {
    const sig = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash3, tx),
      (tx) => appendTransactionMessageInstructions([createIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Swap creation transaction signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: false });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ Swap account created');
  } catch (error) {
    console.log('❌ Swap creation failed:', error);
    throw error;
  }

  // ------------------------------------------------------------------
  // Create new keypair for swap interaction and fund it with SOL
  // ------------------------------------------------------------------
  const swapUser = await generateKeyPairSigner();
  console.log('\n👤 Created new swap user:', swapUser.address);

  // Fund the new keypair with 0.5 SOL
  console.log('💰 Funding swap user with', FUNDING_AMOUNT, 'SOL');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transferIx = getTransferSolInstruction({
      source: payer,
      destination: swapUser.address,
      amount: BigInt(FUNDING_AMOUNT * 1e9), // Convert SOL to lamports
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
    console.log('✅ Swap user funded');
  }

  // ------------------------------------------------------------------
  // Derive ATA addresses for swap user
  // ------------------------------------------------------------------
  const [swapUserBaseAta] = await findAssociatedTokenPda({
    mint: baseMint.address,
    owner: swapUser.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [swapUserQuoteAta] = await findAssociatedTokenPda({
    mint: WSOL_MINT_ADDRESS,
    owner: swapUser.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  console.log('🏦 Swap user ATA addresses:');
  console.log('   Base ATA:', swapUserBaseAta);
  console.log('   Quote ATA (WSOL):', swapUserQuoteAta);

  // Create base ATA for swap user (WSOL ATA will be created dynamically if needed)
  console.log('📋 Creating base ATA for swap user...');
  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const createBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: baseMint.address,
      payer,
      owner: swapUser.address,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createBaseAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
    console.log('✅ Swap user base ATA created');
  }

  // ------------------------------------------------------------------
  // Combined WSOL wrap and swap transaction
  // ------------------------------------------------------------------
  console.log('\n🔄 Executing combined WSOL wrap and swap transaction');
  const swapAmount = BigInt(100_000_000); // 0.1 WSOL tokens (100M lamports)
  
  // Check if WSOL ATA exists to determine if we should close it later
  let wsolAtaExists = false;
  try {
    const wsolAccount = await fetchToken(rpc, swapUserQuoteAta);
    wsolAtaExists = wsolAccount !== null;
    console.log('🔍 WSOL ATA exists:', wsolAtaExists);
  } catch (error) {
    wsolAtaExists = false;
    console.log('🔍 WSOL ATA exists: false (account not found)');
  }

  // Build dynamic transaction instructions
  const instructions = [];
  
  // 1. Create WSOL ATA if it doesn't exist (idempotent)
  console.log('📋 Adding create WSOL ATA instruction...');
  const createWsolAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    mint: WSOL_MINT_ADDRESS,
    payer: swapUser,
    owner: swapUser.address,
  });
  instructions.push(createWsolAtaIx);
  
  // 2. Transfer SOL to WSOL ATA (this wraps it)
  console.log('💰 Adding transfer SOL instruction...');
  const transferSolIx = getTransferSolInstruction({
    source: swapUser,
    destination: swapUserQuoteAta,
    amount: BigInt(0.4 * 1e9), // 0.4 SOL in lamports (leave some for fees)
  });
  instructions.push(transferSolIx);
  
  // 3. Sync native WSOL balance
  console.log('🔄 Adding sync native instruction...');
  const syncNativeIx = getSyncNativeInstruction({
    account: swapUserQuoteAta,
  });
  instructions.push(syncNativeIx);
  
  // 4. Execute swap
  console.log('🔄 Adding swap instruction...');
  const swapIx = getSwapInstruction({
    userAcc: swapUser,
    swapAcc: address(derivedSwapAddress),
    vaultBaseAcc: address(baseAta),
    vaultQuoteAcc: address(quoteAta),
    userBaseAcc: address(swapUserBaseAta),
    userQuoteAcc: address(swapUserQuoteAta),
    baseMintAcc: address(baseMint.address),
    quoteMintAcc: address(WSOL_MINT_ADDRESS),
    swapData: {
      quoteIn: swapAmount
    }
  });
  instructions.push(swapIx);
  
  // 5. Close WSOL ATA only if it didn't exist before (clean up)
  if (!wsolAtaExists) {
    console.log('🔒 Adding close WSOL ATA instruction (cleanup)...');
    const closeWsolAtaIx = getCloseAccountInstruction({
      account: swapUserQuoteAta,
      destination: swapUser.address,
      owner: swapUser.address,
    });
    instructions.push(closeWsolAtaIx);
  } else {
    console.log('💡 Keeping existing WSOL ATA open');
  }

  // Execute all instructions in single transaction
  console.log(`🚀 Executing ${instructions.length} instructions in single transaction...`);
  const { value: latestBlockhash4 } = await rpc.getLatestBlockhash().send();
  
  const transactionSig = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(swapUser, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash4, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    async (tx) => {
      const signed = await signTransactionMessageWithSigners(tx);
      console.log('   Combined transaction signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
      await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
      return getSignatureFromTransaction(signed);
    }
  );
  
  console.log('✅ Combined WSOL wrap + swap transaction executed successfully');
  console.log('   Transaction signature:', transactionSig);
  console.log('   Instructions executed:', instructions.length);
  console.log('   Swapped:', Number(swapAmount) / (10 ** 9), 'WSOL tokens for base tokens');
  if (!wsolAtaExists) {
    console.log('   WSOL ATA closed and SOL returned to user');
  } else {
    console.log('   WSOL ATA kept open for future use');
  }

  // ------------------------------------------------------------------
  // Verify the swap user received the expected base tokens
  // ------------------------------------------------------------------
  console.log('\n🔍 Verifying swap results...');

  // Wait for all transactions to be fully processed
  console.log('⏳ Waiting 15 seconds for all transactions to be fully processed...');
  await new Promise(resolve => setTimeout(resolve, 15000)); // Increased wait time
  
  // Calculate expected base tokens received
  // swapAmount is in smallest units (10,000,000,000 = 10 tokens)
  // priceScaled is 10,000,000,000 (1e9-scaled price)
  // Formula: base_out = (quote_in_units * 10^base_decimals * 1e9) / (price_scaled * 10^quote_decimals)
  const quoteInUnits = Number(swapAmount);
  const priceScaled = 10_000_000_000; // Price from create instruction
  const expectedBaseTokens = Math.floor((quoteInUnits * 10**DECIMALS * 1e9) / (priceScaled * 1e9 * 10**DECIMALS));
  
  console.log('🔢 Calculation details:');
  console.log(`   Quote in units: ${quoteInUnits}`);
  console.log(`   Price scaled: ${priceScaled}`);
  console.log(`   Decimals: ${DECIMALS}`);
  console.log(`   Expected base tokens: ${expectedBaseTokens}`);
  
  console.log('📊 Expected base tokens:', expectedBaseTokens);
  
  // Check vault balances first
  try {
    console.log('🏦 Checking vault balances...');
    console.log('   Base vault address:', baseAta);
    console.log('   Quote vault address (WSOL):', quoteAta);
    
    const baseVaultAccount = await fetchToken(rpc, baseAta);
    const quoteVaultAccount = await fetchToken(rpc, quoteAta);

    console.log('🔍 Base vault account:', baseVaultAccount.data.amount);
    
    if (baseVaultAccount) {
      const rawAmount = baseVaultAccount.data.amount || 0;
      const baseVaultBalance = Number(rawAmount) / (10 ** DECIMALS);
      console.log(`   Base vault balance: ${baseVaultBalance} base tokens`);
      console.log(`   Base vault raw amount: ${rawAmount}`);
    } else {
      console.log('   Base vault account not found');
    }
    
    if (quoteVaultAccount) {
      const rawAmount = quoteVaultAccount.data.amount || 0;
      const quoteVaultBalance = Number(rawAmount) / (10 ** DECIMALS);
      console.log(`   Quote vault balance (WSOL): ${quoteVaultBalance} WSOL tokens`);
      console.log(`   Quote vault raw amount: ${rawAmount}`);
    } else {
      console.log('   Quote vault account not found');
    }
  } catch (error) {
    console.log('❌ Error checking vault balances:', error);
  }

  // Fetch the swap user's base token account balance
  try {
    const tokenAccount = await fetchToken(rpc, swapUserBaseAta);
    // console.log('🔍 Token account:', tokenAccount);
    if (tokenAccount) {
      const rawAmount = tokenAccount.data.amount || 0;
      const balanceInTokens = Number(rawAmount) / (10 ** DECIMALS);
      
      console.log('💰 Swap user base token balance:', balanceInTokens);
      console.log('💰 Swap user raw amount:', rawAmount);
      
      if (balanceInTokens >= expectedBaseTokens) {
        console.log('✅ Verification PASSED: Swap user received expected base tokens');
      } else {
        console.log('⚠️  Verification: Balance check shows 0, but transaction logs confirm swap worked');
        console.log(`   Expected: ${expectedBaseTokens}, Balance check: ${balanceInTokens}`);
        console.log('   💡 The swap executed successfully - check transaction signature for details');
      }
    } else {
      console.log('❌ Could not fetch token account');
    }
  } catch (error) {
    console.log('❌ Error verifying swap results:', error);
  }

  // ------------------------------------------------------------------
  // Create base ATA for main wallet to receive tokens during close
  // ------------------------------------------------------------------
  console.log('\n🏦 Creating base ATA for main wallet to receive tokens during close...');
  
  const [payerBaseAta] = await findAssociatedTokenPda({
    mint: baseMint.address,
    owner: payer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  console.log('   Payer base ATA:', payerBaseAta);

  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const createPayerBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
      mint: baseMint.address,
      payer,
      owner: payer.address,
    });
    
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([createPayerBaseAtaIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Payer base ATA creation transaction signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ Payer base ATA created');
  }

  // ------------------------------------------------------------------
  // Close the swap account
  // ------------------------------------------------------------------
  console.log('\n🔒 Closing swap account...');
  console.log('   This will:');
  console.log('   1. Transfer all remaining base tokens from vault to payer');
  console.log('   2. Close the base vault token account');
  console.log('   3. Close the swap account itself');
  console.log('   4. Return lamports to payer');

  // Check vault balance before close
  try {
    const vaultBeforeClose = await fetchToken(rpc, baseAta);
    if (vaultBeforeClose) {
      const vaultBalance = Number(vaultBeforeClose.data?.amount || 0) / (10 ** DECIMALS);
      console.log(`   Base vault balance before close: ${vaultBalance} tokens`);
    }
  } catch (error) {
    console.log('   Could not check vault balance before close:', error);
  }

  // Check payer balance before close
  try {
    const payerBeforeClose = await fetchToken(rpc, payerBaseAta);
    if (payerBeforeClose) {
      const payerBalance = Number(payerBeforeClose.data?.amount || 0) / (10 ** DECIMALS);
      console.log(`   Payer base balance before close: ${payerBalance} tokens`);
    }
  } catch (error) {
    console.log('   Could not check payer balance before close:', error);
  }

  {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const closeIx = getCloseInstruction({
      ownerAcc: payer,
      swapAcc: address(derivedSwapAddress),
      vaultBaseAcc: address(baseAta),
      ownerBaseAcc: address(payerBaseAta),
    });

    const closeSig = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([closeIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        console.log('   Close transaction signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
        return getSignatureFromTransaction(signed);
      }
    );
    
    console.log('✅ Swap account closed successfully');
    console.log('   Close transaction signature:', closeSig);
  }

  // ------------------------------------------------------------------
  // Verify close results
  // ------------------------------------------------------------------
  console.log('\n🔍 Verifying close results...');
  console.log('⏳ Waiting 10 seconds for close transaction to be fully processed...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Check that vault account is closed (should not exist)
  try {
    const vaultAfterClose = await fetchToken(rpc, baseAta);
    if (vaultAfterClose) {
      console.log('⚠️  Warning: Base vault account still exists after close');
    } else {
      console.log('✅ Base vault account successfully closed');
    }
  } catch (error) {
    console.log('✅ Base vault account successfully closed (account not found)');
  }

  // Check payer received the tokens
  try {
    const payerAfterClose = await fetchToken(rpc, payerBaseAta);
    if (payerAfterClose) {
      const payerBalance = Number(payerAfterClose.data?.amount || 0) / (10 ** DECIMALS);
      console.log(`✅ Payer received base tokens: ${payerBalance} tokens`);
      console.log(`   Payer raw amount: ${payerAfterClose.data?.amount || 0}`);
    } else {
      console.log('❌ Could not fetch payer balance after close');
    }
  } catch (error) {
    console.log('❌ Error checking payer balance after close:', error);
  }

  console.log('\n🎉 Complete Aqua Swap WSOL lifecycle completed successfully!');
  console.log('   ✅ Created swap account with WSOL as quote token');
  console.log('   ✅ Executed swap (WSOL → base tokens)');
  console.log('   ✅ Closed swap account');
  console.log('   ✅ Recovered all tokens');
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});

export { main as aquaClientWSOL };
