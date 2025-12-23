/**
 * Claim Fees Script
 * Claims accumulated fees from token positions.
 * 
 * Required env vars:
 * - BAGS_API_KEY
 * - SOLANA_RPC_URL
 * - PRIVATE_KEY (base58 encoded)
 */

import dotenv from "dotenv";
dotenv.config();

import { BagsSDK, signAndSendTransaction } from "@bagsfm/bags-sdk";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Connection } from "@solana/web3.js";
import bs58 from "bs58";

// Validate environment
const BAGS_API_KEY = process.env.BAGS_API_KEY;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!BAGS_API_KEY || !SOLANA_RPC_URL || !PRIVATE_KEY) {
  throw new Error("Missing required environment variables");
}

// Initialize
const connection = new Connection(SOLANA_RPC_URL);
const sdk = new BagsSDK(BAGS_API_KEY, connection, "processed");
const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

/**
 * Get all claimable positions for a wallet
 */
async function getClaimablePositions(wallet?: PublicKey) {
  const w = wallet || keypair.publicKey;
  
  console.log(`Fetching claimable positions for: ${w.toBase58()}`);
  
  const positions = await sdk.fee.getAllClaimablePositions(w);
  
  if (positions.length === 0) {
    console.log("\n⚠️  No claimable positions found");
    return [];
  }

  console.log(`\n📊 Found ${positions.length} position(s):\n`);

  let totalClaimable = 0;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    
    // Calculate claimable amount
    let claimable = 0;
    if (pos.virtualPoolClaimableAmount) {
      claimable += Number(pos.virtualPoolClaimableAmount);
    }
    if (pos.dammPoolClaimableAmount) {
      claimable += Number(pos.dammPoolClaimableAmount);
    }
    if (pos.isCustomFeeVault && pos.customFeeVaultBalance && pos.customFeeVaultBps) {
      claimable += pos.customFeeVaultBalance * (pos.customFeeVaultBps / 10000);
    }

    totalClaimable += claimable;
    const claimableSol = claimable / LAMPORTS_PER_SOL;

    console.log(`${i + 1}. Token: ${pos.baseMint.slice(0, 8)}...`);
    console.log(`   Claimable: ${claimableSol.toFixed(6)} SOL`);
    
    if (pos.virtualPoolClaimableAmount) {
      console.log(`   - Virtual pool: ${(Number(pos.virtualPoolClaimableAmount) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    }
    if (pos.dammPoolClaimableAmount) {
      console.log(`   - DAMM v2: ${(Number(pos.dammPoolClaimableAmount) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    }
    if (pos.isCustomFeeVault) {
      console.log(`   - Custom vault (${pos.customFeeVaultBps! / 100}% share)`);
    }
    if (pos.isMigrated) {
      console.log(`   - Status: Migrated to DAMM v2`);
    }
    console.log();
  }

  console.log(`💰 Total claimable: ${(totalClaimable / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  return positions;
}

/**
 * Claim fees for a specific token
 */
async function claimForToken(tokenMint: string, wallet?: PublicKey) {
  const w = wallet || keypair.publicKey;
  const commitment = sdk.state.getCommitment();

  console.log(`Claiming fees for token: ${tokenMint}`);
  console.log(`Wallet: ${w.toBase58()}\n`);

  // Get positions
  const allPositions = await sdk.fee.getAllClaimablePositions(w);
  const positions = allPositions.filter(p => p.baseMint === tokenMint);

  if (positions.length === 0) {
    console.log("⚠️  No claimable positions for this token");
    return;
  }

  console.log(`Found ${positions.length} position(s) for this token\n`);

  // Claim each position
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    console.log(`Processing position ${i + 1}/${positions.length}...`);

    const transactions = await sdk.fee.getClaimTransaction(w, position);

    if (!transactions.length) {
      console.log("   No transactions generated");
      continue;
    }

    for (let j = 0; j < transactions.length; j++) {
      try {
        const sig = await signAndSendTransaction(connection, commitment, transactions[j], keypair);
        console.log(`   TX ${j + 1}/${transactions.length}: ${sig}`);
      } catch (e: any) {
        console.log(`   TX ${j + 1} failed: ${e.message}`);
      }
    }
  }

  console.log("\n✅ Claim complete");
}

/**
 * Claim all available fees
 */
async function claimAll(wallet?: PublicKey) {
  const w = wallet || keypair.publicKey;
  const commitment = sdk.state.getCommitment();

  console.log(`Claiming ALL fees for: ${w.toBase58()}\n`);

  const positions = await sdk.fee.getAllClaimablePositions(w);

  if (positions.length === 0) {
    console.log("⚠️  No claimable positions");
    return;
  }

  console.log(`Processing ${positions.length} position(s)...\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    console.log(`[${i + 1}/${positions.length}] ${position.baseMint.slice(0, 12)}...`);

    try {
      const transactions = await sdk.fee.getClaimTransaction(w, position);

      for (const tx of transactions) {
        await signAndSendTransaction(connection, commitment, tx, keypair);
      }

      console.log("   ✓ Claimed");
      successCount++;
    } catch (e: any) {
      console.log(`   ✗ Failed: ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n✅ Complete: ${successCount} succeeded, ${failCount} failed`);
}

// Main execution
async function main() {
  const action = process.argv[2] || "list";
  const tokenMint = process.argv[3];

  switch (action) {
    case "list":
      await getClaimablePositions();
      break;
    case "claim":
      if (tokenMint) {
        await claimForToken(tokenMint);
      } else {
        console.log("Usage: npx ts-node claim-fees.ts claim <TOKEN_MINT>");
      }
      break;
    case "claim-all":
      await claimAll();
      break;
    default:
      console.log("Usage:");
      console.log("  npx ts-node claim-fees.ts list              # List claimable positions");
      console.log("  npx ts-node claim-fees.ts claim <MINT>      # Claim for specific token");
      console.log("  npx ts-node claim-fees.ts claim-all         # Claim all positions");
  }
}

main().catch(console.error);
