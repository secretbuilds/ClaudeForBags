/**
 * Create Partner Key Script
 * Creates a partner configuration for earning 25% of fees from token launches.
 * 
 * Required env vars:
 * - BAGS_API_KEY
 * - SOLANA_RPC_URL
 * - PRIVATE_KEY (base58 encoded)
 */

import dotenv from "dotenv";
dotenv.config();

import {
  BagsSDK,
  signAndSendTransaction,
  deriveBagsFeeShareV2PartnerConfigPda,
} from "@bagsfm/bags-sdk";
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
 * Create a partner key for the wallet
 * Note: One partner key per wallet. Run once, save the PDA.
 */
async function createPartnerKey(partnerWallet?: PublicKey) {
  const wallet = partnerWallet || keypair.publicKey;
  const commitment = sdk.state.getCommitment();

  console.log(`Creating partner key for: ${wallet.toBase58()}`);

  // Derive the partner config PDA
  const partnerConfigPda = deriveBagsFeeShareV2PartnerConfigPda(wallet);
  console.log(`Partner Config PDA: ${partnerConfigPda.toBase58()}`);

  // Check if already exists
  try {
    const existing = await sdk.partner.getPartnerConfig(wallet);
    console.log("\n⚠️  Partner config already exists!");
    console.log(`   Partner: ${existing.partner.toBase58()}`);
    console.log(`   BPS: ${existing.bps} (${existing.bps / 100}%)`);
    console.log(`   Total claimed: ${existing.totalClaimedFees.toString()} lamports`);
    return partnerConfigPda;
  } catch (e: any) {
    if (!e.message?.includes("not found")) {
      throw e;
    }
    // Doesn't exist, proceed with creation
  }

  // Get creation transaction
  console.log("Getting creation transaction...");
  const { transaction, blockhash } = await sdk.partner.getPartnerConfigCreationTransaction(wallet);

  // Sign and send
  console.log("Signing and sending...");
  const signature = await signAndSendTransaction(connection, commitment, transaction, keypair, blockhash);

  console.log("\n✅ Partner key created!");
  console.log(`   Partner Config PDA: ${partnerConfigPda.toBase58()}`);
  console.log(`   Transaction: ${signature}`);
  console.log(`\n📝 Save these values for token launches:`);
  console.log(`   partner: "${wallet.toBase58()}"`);
  console.log(`   partnerConfig: "${partnerConfigPda.toBase58()}"`);

  return partnerConfigPda;
}

/**
 * Get partner statistics
 */
async function getPartnerStats(partnerWallet?: PublicKey) {
  const wallet = partnerWallet || keypair.publicKey;

  console.log(`Getting stats for: ${wallet.toBase58()}`);

  try {
    const stats = await sdk.partner.getPartnerConfigClaimStats(wallet);
    
    const claimed = Number(stats.claimedFees) / LAMPORTS_PER_SOL;
    const unclaimed = Number(stats.unclaimedFees) / LAMPORTS_PER_SOL;
    
    console.log("\n📊 Partner Statistics:");
    console.log(`   Claimed: ${claimed.toFixed(4)} SOL`);
    console.log(`   Unclaimed: ${unclaimed.toFixed(4)} SOL`);
    console.log(`   Total earned: ${(claimed + unclaimed).toFixed(4)} SOL`);

    return stats;
  } catch (e: any) {
    if (e.message?.includes("not found")) {
      console.log("\n❌ Partner config not found. Create one first.");
    } else {
      throw e;
    }
  }
}

/**
 * Claim partner fees
 */
async function claimPartnerFees(partnerWallet?: PublicKey) {
  const wallet = partnerWallet || keypair.publicKey;
  const commitment = sdk.state.getCommitment();

  console.log(`Claiming partner fees for: ${wallet.toBase58()}`);

  // Check unclaimed amount
  const stats = await sdk.partner.getPartnerConfigClaimStats(wallet);
  const unclaimed = Number(stats.unclaimedFees) / LAMPORTS_PER_SOL;

  if (unclaimed === 0) {
    console.log("\n⚠️  No unclaimed fees");
    return;
  }

  console.log(`Unclaimed: ${unclaimed.toFixed(4)} SOL`);

  // Get claim transactions
  const transactions = await sdk.partner.getPartnerClaimTransactions(wallet);

  if (!transactions.length) {
    console.log("\n⚠️  No claim transactions generated");
    return;
  }

  console.log(`Executing ${transactions.length} claim transaction(s)...`);

  for (let i = 0; i < transactions.length; i++) {
    const signature = await signAndSendTransaction(connection, commitment, transactions[i], keypair);
    console.log(`   ${i + 1}/${transactions.length}: ${signature}`);
  }

  console.log("\n✅ Partner fees claimed!");
}

// Main execution
async function main() {
  const action = process.argv[2] || "create";

  switch (action) {
    case "create":
      await createPartnerKey();
      break;
    case "stats":
      await getPartnerStats();
      break;
    case "claim":
      await claimPartnerFees();
      break;
    default:
      console.log("Usage: npx ts-node create-partner-key.ts [create|stats|claim]");
  }
}

main().catch(console.error);
