#!/usr/bin/env tsx

import { createSolanaRpc, getProgramDerivedAddress, address } from '@solana/kit';
import { v4 as uuidv4, parse as uuidParse } from 'uuid';
import { AQUA_SWAP_PROGRAM_ADDRESS } from './clients/js/src/generated/programs/aquaSwap';

async function main() {
  console.log('🔧 PDA test start');
  // Simple RPC call to ensure environment
  const rpc = createSolanaRpc('https://api.devnet.solana.com');
  const { value } = await rpc.getLatestBlockhash().send();
  console.log('✅ RPC ok. blockhash:', value.blockhash.slice(0, 8), '...');

  // UUID -> bytes (16)
  const uuidStr = uuidv4();
  const uuidBytes = uuidParse(uuidStr); // Uint8Array(16)
  console.log('🆔 UUID:', uuidStr);

  // Derive PDA using @solana/kit helper
  const result = await getProgramDerivedAddress({
    programAddress: AQUA_SWAP_PROGRAM_ADDRESS,
    seeds: [uuidBytes],
  });

  // result shape differs by kit version; print it
  console.log('📦 getProgramDerivedAddress result:', result);

  // Normalize address field safely for tuple or object shapes
  let pda: string | undefined;
  let bump: number | undefined;
  if (Array.isArray(result)) {
    [pda, bump] = result as [string, number];
  } else if ((result as any).programDerivedAddress) {
    pda = (result as any).programDerivedAddress;
    bump = (result as any).bumpSeed;
  } else if ((result as any).address) {
    pda = (result as any).address;
    bump = (result as any).bumpSeed;
  } else if (typeof result === 'string') {
    pda = result as string;
  }

  if (!pda) {
    throw new Error('Failed to derive PDA: unexpected return shape');
  }

  console.log('📍 PDA:', pda);
  console.log('🔢 bumpSeed:', bump);
  console.log('✅ address() coercion ok:', address(pda));
}

main().catch((e) => {
  console.error('❌ PDA test failed:', e);
  process.exit(1);
});


