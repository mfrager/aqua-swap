#!/usr/bin/env tsx

/**
 * Aqua Swap bonus test client (SPL-only)
 * - Creates base and quote SPL mints
 * - Creates swap PDA and vaults
 * - Sets both base and quote bonuses
 * - Executes swap from a fresh user wallet
 * - Verifies vault, user, and bonus recipient balances
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
import {
  getCreateInstruction,
  getSwapInstruction,
  getCloseInstruction,
  AQUA_SWAP_PROGRAM_ADDRESS
} from './clients/js/src/generated'

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const DECIMALS = 9;
const FUNDING_AMOUNT = 0.5; // SOL to fund created wallets

// Swap parameters
const MINT_BASE_AMOUNT = 100_000; // base tokens minted to vault
const SWAP_QUOTE_TOKENS = 100;    // tokens user pays
const BONUS_PERCENT = 10_000_000_000n; // 10% scaled by 1e9, denominator 100_000_000_000

async function main() {
  console.log('🚀 Aqua Swap bonus client (SPL-only)');

  // RPC setup
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Load payer from ~/.config/solana/id.json and create signer
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletData = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(walletData));
  console.log('📝 Payer:', payer.address);

  // Generate swap user and bonus recipient wallets
  const swapUser = await generateKeyPairSigner();
  const bonusRecipient = await generateKeyPairSigner();
  console.log('👤 Swap user:', swapUser.address);
  console.log('🎁 Bonus recipient (quote):', bonusRecipient.address);

  // Fund new wallets with SOL
  for (const who of [swapUser.address, bonusRecipient.address]) {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ix = getTransferSolInstruction({
      source: payer,
      destination: who,
      amount: BigInt(FUNDING_AMOUNT * 1e9),
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([ix], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
  }

  // Derive Swap PDA
  const uuidStr = uuidv4();
  const uuidBytes = uuidParse(uuidStr);
  const uuid = toBigIntLE(Buffer.from(uuidBytes));
  const [swapPda, bumpSeed] = await getProgramDerivedAddress({
    programAddress: AQUA_SWAP_PROGRAM_ADDRESS,
    seeds: [uuidBytes],
  });
  console.log('📍 Swap PDA:', swapPda, 'bump:', bumpSeed);

  // Create BASE and QUOTE mints (SPL-only)
  const baseMint = await generateKeyPairSigner();
  const quoteMint = await generateKeyPairSigner();

  for (const mint of [baseMint, quoteMint]) {
    const space = BigInt(getMintSize());
    const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ixs = [
      getCreateAccountInstruction({ payer, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeMintInstruction({ mint: mint.address, decimals: DECIMALS, mintAuthority: payer.address }),
    ];
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions(ixs, tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
  }
  console.log('✅ Created BASE and QUOTE mints');

  // Vault ATAs
  const [baseVaultAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: swapPda, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [quoteVaultAta] = await findAssociatedTokenPda({ mint: quoteMint.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });

  // Create vault ATAs and mint base to vault
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const createBaseVaultIx = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: swapPda });
    const createQuoteVaultIx = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: quoteMint.address, payer, owner: payer.address });
    const mintBaseToVaultIx = getMintToInstruction({
      mint: baseMint.address,
      token: baseVaultAta,
      amount: BigInt(MINT_BASE_AMOUNT) * BigInt(10 ** DECIMALS),
      mintAuthority: payer,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([createBaseVaultIx, createQuoteVaultIx, mintBaseToVaultIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
  }
  console.log('✅ Vaults created; base funded');

  // Create swap account with both bonuses (SPL-only: quote_sol=false)
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const createIx = getCreateInstruction({
      ownerAcc: payer,
      verifyAcc: payer.address,
      swapAcc: address(swapPda),
      vaultBaseAcc: address(baseVaultAta),
      vaultQuoteAcc: address(quoteVaultAta),
      createData: {
        uuid,
        price: 10_000_000_000, // 10 quote per 1 base (scaled by 1e9)
        bonusBase: Number(BONUS_PERCENT),
        bonusQuote: Number(BONUS_PERCENT),
        bumpSeed: Number(bumpSeed),
        requireVerify: false,
      },
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([createIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
  }
  console.log('✅ Swap account created with bonuses');

  // Create ATAs for swap user
  const [swapUserBaseAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: swapUser.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [swapUserQuoteAta] = await findAssociatedTokenPda({ mint: quoteMint.address, owner: swapUser.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ix1 = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: swapUser.address });
    const ix2 = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: quoteMint.address, payer, owner: swapUser.address });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([ix1, ix2], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
  }
  console.log('✅ Swap user ATAs created');

  // Create bonus recipient ATAs (quote and base)
  const [bonusQuoteAta] = await findAssociatedTokenPda({ mint: quoteMint.address, owner: bonusRecipient.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [bonusBaseAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: bonusRecipient.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ixQuote = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: quoteMint.address, payer, owner: bonusRecipient.address });
    const ixBase = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: bonusRecipient.address });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([ixQuote, ixBase], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return null as unknown as string;
      }
    );
  }
  console.log('✅ Bonus recipient ATAs created (quote and base)');

  // Mint quote to swap user
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const mintQuoteToUser = getMintToInstruction({
      mint: quoteMint.address,
      token: swapUserQuoteAta,
      amount: BigInt(SWAP_QUOTE_TOKENS) * BigInt(10 ** DECIMALS),
      mintAuthority: payer,
    });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([mintQuoteToUser], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
  }
  console.log('✅ Minted quote tokens to swap user');

  // Helper to fetch token amount (raw u64)
  const getAmount = async (tokenAddr: string) => {
    const acc = await fetchToken(rpc, tokenAddr);
    return Number(acc?.data?.amount || 0);
  };

  // Snapshot balances before swap
  const before = {
    baseVault: await getAmount(baseVaultAta),
    quoteVault: await getAmount(quoteVaultAta),
    userBase: await getAmount(swapUserBaseAta),
    userQuote: await getAmount(swapUserQuoteAta),
    bonusQuote: await getAmount(bonusQuoteAta),
    bonusBase: await getAmount(bonusBaseAta),
  };

  // Execute swap (note: pass bonus_base_acc = base vault; bonus_quote_acc = bonus recipient)
  const swapAmountUnits = BigInt(SWAP_QUOTE_TOKENS) * BigInt(10 ** DECIMALS);
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const swapIx = getSwapInstruction({
      userAcc: swapUser,
      swapAcc: address(swapPda),
      vaultBaseAcc: address(baseVaultAta),
      vaultQuoteAcc: address(quoteVaultAta),
      userBaseAcc: address(swapUserBaseAta),
      userQuoteAcc: address(swapUserQuoteAta),
      baseMintAcc: address(baseMint.address),
      quoteMintAcc: address(quoteMint.address),
      bonusBaseAcc: address(bonusBaseAta),
      bonusQuoteAcc: address(bonusQuoteAta),
      wsolTempAcc: address(swapUserQuoteAta), // unused for SPL path
      swapData: { quoteIn: swapAmountUnits },
    });
    const sig = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(swapUser, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([swapIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('✅ Swap executed; tx:', sig);
  }

  // Snapshot balances after swap
  const after = {
    baseVault: await getAmount(baseVaultAta),
    quoteVault: await getAmount(quoteVaultAta),
    userBase: await getAmount(swapUserBaseAta),
    userQuote: await getAmount(swapUserQuoteAta),
    bonusQuote: await getAmount(bonusQuoteAta),
    bonusBase: await getAmount(bonusBaseAta),
  };

  // Compute expected amounts (mirrors on-chain math)
  const priceScaled = 10_000_000_000n; // 1e9-scaled price
  const baseScale = BigInt(10 ** DECIMALS);
  const quoteScale = BigInt(10 ** DECIMALS);
  const B = 1_000_000_000n;
  // base_out = (Q * 10^bd * 1e9) / (price_scaled * 10^qd)
  const baseOut = (swapAmountUnits * baseScale * B) / (priceScaled * quoteScale);
  const denom = 100_000_000_000n;
  const quoteBonus = (swapAmountUnits * BONUS_PERCENT) / denom;
  const quoteToVault = swapAmountUnits - quoteBonus;
  const baseBonus = (baseOut * BONUS_PERCENT) / denom;

  // Convert BigInt to number safely for logs (values are within u64 range for this test)
  const n = (x: bigint) => Number(x);

  console.log('\n📊 Balance changes (raw smallest units):');
  console.log('  Quote sent total:', n(swapAmountUnits));
  console.log('  Quote to vault (expected):', n(quoteToVault), 'Δ', after.quoteVault - before.quoteVault);
  console.log('  Quote bonus to recipient (expected):', n(quoteBonus), 'Δ', after.bonusQuote - before.bonusQuote);
  console.log('  Base out (expected to user):', n(baseOut), 'Δ', after.userBase - before.userBase);
  console.log('  Base bonus to recipient (expected):', n(baseBonus), 'Δ', after.bonusBase - before.bonusBase);
  console.log('  Base vault decrease (approx expected):', n(baseOut + baseBonus), 'Δ', before.baseVault - after.baseVault);

  // Simple assertions
  const approxEq = (a: number, b: number) => a === b; // all integer math
  const pass = approxEq(after.quoteVault - before.quoteVault, n(quoteToVault)) &&
               approxEq(after.bonusQuote - before.bonusQuote, n(quoteBonus)) &&
               approxEq(after.userBase - before.userBase, n(baseOut)) &&
               approxEq(after.bonusBase - before.bonusBase, n(baseBonus));

  if (pass) {
    console.log('\n✅ Bonus verification PASSED');
  } else {
    console.log('\n❌ Bonus verification FAILED');
  }

  // Optional: close swap and reclaim base to payer
  try {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const [payerBaseAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const createPayerBaseAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: payer.address });
    const closeIx = getCloseInstruction({ ownerAcc: payer, swapAcc: address(swapPda), vaultBaseAcc: address(baseVaultAta), ownerBaseAcc: address(payerBaseAta) });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([createPayerBaseAtaIx, closeIx], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
        return getSignatureFromTransaction(signed);
      }
    );
    console.log('🔒 Swap closed');
  } catch (e) {
    console.log('⚠️ Close skipped/failed:', (e as Error).message);
  }
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});

export { main as aquaClientBonuses };


