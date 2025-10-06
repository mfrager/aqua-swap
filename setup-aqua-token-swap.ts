#!/usr/bin/env tsx

/**
 * Aqua Swap WSOL bonus test client
 * - Uses WSOL as the quote token
 * - Tests both Quote (SOL) and Base (SPL) bonuses
 * - Ensures wsolTempAcc is the WSOL ATA owned by the swap PDA (passed in the swap)
 * - Quote bonus recipient is a system account that receives SOL via transfer
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
import bs58 from 'bs58';
import {
  getInitializeMintInstruction,
  getMintSize,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken
} from '@solana-program/token';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';

import {
  getCreateInstruction,
  getSwapInstruction,
  getCloseInstruction,
  AQUA_SWAP_PROGRAM_ADDRESS
} from './clients/js/src/generated';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const RPC_URL = 'https://api.mainnet-beta.solana.com';
const WS_URL = 'wss://api.mainnet-beta.solana.com';
const DECIMALS = 9;
const FUNDING_AMOUNT = 0.5; // SOL to fund created wallets

// Swap parameters
const MINT_BASE_AMOUNT = 100_000; // base tokens minted to vault
const BASE_BONUS_PERCENT = 50_000_000_000n; // 50% scaled by 1e9; denom 100_000_000_000
const QUOTE_BONUS_PERCENT = 50_000_000_000n; // 50% scaled by 1e9; denom 100_000_000_000

async function main() {
  console.log('🚀 Aqua Swap WSOL bonus client');

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Load payer
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletData = JSON.parse(readFileSync(walletPath, 'utf8')) as number[];
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(walletData));
  console.log('📝 Payer:', payer.address);

  // Actors
  /* const swapUser = await generateKeyPairSigner();
  const quoteVaultOwner = await generateKeyPairSigner(); // system account that will receive SOL to vault
  const bonusRecipient = await generateKeyPairSigner(); // system account to receive SOL bonus; also base bonus ATA owner
  console.log('👤 Swap user:', swapUser.address);
  console.log('🏦 Quote vault owner (system account):', quoteVaultOwner.address);
  console.log('🎁 Bonus recipient (system account):', bonusRecipient.address);

  // Fund new wallets with SOL
  for (const who of [swapUser.address, quoteVaultOwner.address, bonusRecipient.address]) {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ix = getTransferSolInstruction({ source: payer, destination: who, amount: BigInt(FUNDING_AMOUNT * 1e9) });
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
  } */

  // Derive Swap PDA
  const uuidStr = uuidv4();
  const uuidBytes = uuidParse(uuidStr);
  const uuid = toBigIntLE(Buffer.from(uuidBytes));
  const [swapPda, bumpSeed] = await getProgramDerivedAddress({ programAddress: AQUA_SWAP_PROGRAM_ADDRESS, seeds: [uuidBytes] });
  console.log('📍 Swap PDA:', swapPda, 'bump:', bumpSeed, 'uuid:', uuidStr, 'uuid int:', uuid.toString());

  // Create BASE mint
  const baseMint = address('AQUA8K121ayXRSHFgsZDcTKGj2qmrrQ8Ca2rjoyFQWSv')
  console.log('✅ BASE mint:', baseMint.toString());

  const quoteVaultWsolAta = address('2ntdVC2Qs9bpDupBEnATkRYoLfzALeodNQSZqns2UY9o')

  // Vault addresses
  const [baseVaultAta] = await findAssociatedTokenPda({ mint: baseMint, owner: swapPda, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  // const [quoteVaultWsolAta] = await findAssociatedTokenPda({ mint: WSOL_MINT, owner: quoteVaultOwner.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  // Note: We pass a WSOL ATA for create(); program records its owner for SOL vaulting

  // Create vault ATAs and mint base to vault
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ix1 = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint, payer, owner: swapPda });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
      (tx) => appendTransactionMessageInstructions([ix1], tx),
      async (tx) => {
        const signed = await signTransactionMessageWithSigners(tx);
        await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signed);
      }
    );
  }
  console.log('✅ Vaults prepared');

  // Create swap with bonuses
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const createIx = getCreateInstruction({
      ownerAcc: payer,
      swapAcc: address(swapPda),
      vaultBaseAcc: address(baseVaultAta),
      vaultQuoteAcc: address(quoteVaultWsolAta), // WSOL ATA; program stores its owner for SOL transfers
      createData: {
        uuid,
        price: 2500, // 400000 AQUA per 1 SOL
        bonusBase: Number(BASE_BONUS_PERCENT),
        bonusQuote: Number(QUOTE_BONUS_PERCENT),
        bumpSeed: Number(bumpSeed),
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
  console.log('✅ Swap created with bonuses (WSOL mode)');

  /* 
  // User ATAs: base for receipts, WSOL for paying
  const [userBaseAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: swapUser.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [userWsolAta] = await findAssociatedTokenPda({ mint: WSOL_MINT, owner: swapUser.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ix1 = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: swapUser.address });
    const ix2 = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: WSOL_MINT, payer: swapUser, owner: swapUser.address });
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
  console.log('✅ User ATAs prepared');

  // Bonus base recipient ATA
  const [bonusBaseAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: bonusRecipient.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  {
    const { value: bh } = await rpc.getLatestBlockhash().send();
    const ix = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: bonusRecipient.address });
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
  console.log('✅ Bonus base ATA prepared');

  // Compute WSOL temp ATA owned by swap PDA
  const [wsolTempAta] = await findAssociatedTokenPda({ mint: WSOL_MINT, owner: swapPda, tokenProgram: TOKEN_PROGRAM_ADDRESS });

  // Balances before
  const getTokenAmount = async (tokenAddr: string) => Number((await fetchToken(rpc, tokenAddr))?.data?.amount || 0);
  const getLamports = async (pubkey: string) => (await rpc.getBalance(address(pubkey)).send()).value;

  const before = {
    baseVault: await getTokenAmount(baseVaultAta),
    userBase: await getTokenAmount(userBaseAta),
    userWsol: await getTokenAmount(userWsolAta),
    vaultSol: await getLamports(quoteVaultOwner.address),
    bonusQuoteLamports: await getLamports(bonusRecipient.address),
    bonusBase: await getTokenAmount(bonusBaseAta),
  };

  // Build combined wrap + swap tx
  const swapAmountUnits = BigInt(Math.floor(SWAP_QUOTE_TOKENS * 10 ** DECIMALS));
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const instructions = [] as any[];
  // Ensure user WSOL ATA exists (idempotent)
  instructions.push(await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: WSOL_MINT, payer: swapUser, owner: swapUser.address }));
  // Wrap SOL into user WSOL ATA
  instructions.push(getTransferSolInstruction({ source: swapUser, destination: userWsolAta, amount: swapAmountUnits }));
  instructions.push(getSyncNativeInstruction({ account: userWsolAta }));
  // Swap instruction (program will create wsolTempAcc idempotently if needed)
  const swapIx = getSwapInstruction({
    userAcc: swapUser,
    swapAcc: address(swapPda),
    vaultBaseAcc: address(baseVaultAta),
    vaultQuoteAcc: address(quoteVaultOwner.address), // system account: owner captured from WSOL ATA at create
    userBaseAcc: address(userBaseAta),
    userQuoteAcc: address(userWsolAta),
    baseMintAcc: address(baseMint.address),
    quoteMintAcc: address(WSOL_MINT),
    bonusBaseAcc: address(bonusBaseAta),
    bonusQuoteAcc: address(bonusRecipient.address), // system account receives SOL bonus
    wsolTempAcc: address(wsolTempAta), // WSOL ATA owned by swap PDA
    swapData: { quoteIn: swapAmountUnits },
  });
  instructions.push(swapIx);

  const sig = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(swapUser, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(bh, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    async (tx) => {
      const signed = await signTransactionMessageWithSigners(tx);
      console.log('   Swap tx signature:', bs58.encode((signed as any).signatures[Object.keys(signed.signatures)[0]]));
      await sendAndConfirmTransaction(signed as any, { commitment: 'confirmed', skipPreflight: true });
      return getSignatureFromTransaction(signed);
    }
  );
  console.log('✅ Swap executed:', sig);

  // After balances
  const after = {
    baseVault: await getTokenAmount(baseVaultAta),
    userBase: await getTokenAmount(userBaseAta),
    userWsol: await getTokenAmount(userWsolAta),
    vaultSol: await getLamports(quoteVaultOwner.address),
    bonusQuoteLamports: await getLamports(bonusRecipient.address),
    bonusBase: await getTokenAmount(bonusBaseAta),
  };

  // Expectations (mirror on-chain)
  const priceScaled = 10_000_000_000n;
  const baseScale = BigInt(10 ** DECIMALS);
  const quoteScale = BigInt(10 ** DECIMALS);
  const B = 1_000_000_000n;
  const denom = 100_000_000_000n;
  const baseOut = (swapAmountUnits * baseScale * B) / (priceScaled * quoteScale);
  const quoteBonus = (swapAmountUnits * BONUS_PERCENT) / denom; // in lamports
  const quoteToVault = swapAmountUnits - quoteBonus; // lamports to vault owner
  const baseBonus = (baseOut * BONUS_PERCENT) / denom;

  const n = (x: bigint) => Number(x);
  console.log('\n📊 Deltas:');
  console.log('  Base to user:', after.userBase - before.userBase, '(expected', n(baseOut), ')');
  console.log('  Base bonus to recipient:', after.bonusBase - before.bonusBase, '(expected', n(baseBonus), ')');
  console.log('  SOL to vault owner:', Number(after.vaultSol - before.vaultSol), '(expected', n(quoteToVault), ')');
  console.log('  SOL bonus to recipient:', Number(after.bonusQuoteLamports - before.bonusQuoteLamports), '(expected', n(quoteBonus), ')');

  const pass = (after.userBase - before.userBase) === n(baseOut)
            && (after.bonusBase - before.bonusBase) === n(baseBonus)
            && Number(after.vaultSol - before.vaultSol) === n(quoteToVault)
            && Number(after.bonusQuoteLamports - before.bonusQuoteLamports) === n(quoteBonus);
  console.log(pass ? '\n✅ Bonus verification PASSED' : '\n❌ Bonus verification FAILED');

  // Close swap to reclaim base to payer
  try {
    const [payerBaseAta] = await findAssociatedTokenPda({ mint: baseMint.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const { value: bh2 } = await rpc.getLatestBlockhash().send();
    const ixCreatePayerBase = await getCreateAssociatedTokenIdempotentInstructionAsync({ mint: baseMint.address, payer, owner: payer.address });
    const closeIx = getCloseInstruction({ ownerAcc: payer, swapAcc: address(swapPda), vaultBaseAcc: address(baseVaultAta), ownerBaseAcc: address(payerBaseAta) });
    await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(bh2, tx),
      (tx) => appendTransactionMessageInstructions([ixCreatePayerBase, closeIx], tx),
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
  */
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});

export { main as aquaClientWsolBonuses };


