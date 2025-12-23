/**
 * Token Launch with Fee Sharing Script
 * Launches a token with fees split among multiple wallets.
 * Handles >15 claimers with lookup tables automatically.
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
  createTipTransaction,
  sendBundleAndConfirm,
  waitForSlotsToPass,
  BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT,
} from "@bagsfm/bags-sdk";
import type { SupportedSocialProvider } from "@bagsfm/bags-sdk";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Connection, VersionedTransaction } from "@solana/web3.js";
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

const FALLBACK_JITO_TIP = 0.015 * LAMPORTS_PER_SOL;

async function sendWithJito(transactions: VersionedTransaction[]): Promise<string> {
  const commitment = sdk.state.getCommitment();
  const blockhash = transactions[0]?.message.recentBlockhash;
  if (!blockhash) throw new Error("Transaction missing blockhash");

  let tipLamports = FALLBACK_JITO_TIP;
  try {
    const jitoFees = await sdk.solana.getJitoRecentFees();
    if (jitoFees?.landed_tips_95th_percentile) {
      tipLamports = Math.floor(jitoFees.landed_tips_95th_percentile * LAMPORTS_PER_SOL);
    }
  } catch {}

  const tipTx = await createTipTransaction(connection, commitment, keypair.publicKey, tipLamports, { blockhash });
  const signedTxs = [tipTx, ...transactions].map(tx => {
    tx.sign([keypair]);
    return tx;
  });

  return await sendBundleAndConfirm(signedTxs, sdk);
}

/**
 * Fee claimer configuration
 */
interface FeeClaimer {
  // Either provide wallet directly OR social username
  wallet?: PublicKey;
  username?: string;
  provider?: SupportedSocialProvider;  // "twitter" | "kick" | "github"
  bps: number;  // Basis points (10000 = 100%)
}

/**
 * Launch token with fee sharing
 */
async function launchWithFeeShare(params: {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  initialBuySol: number;
  feeClaimers: FeeClaimer[];  // Creator should be included here
  twitter?: string;
  website?: string;
}) {
  const commitment = sdk.state.getCommitment();

  // Validate BPS
  const totalBps = params.feeClaimers.reduce((sum, fc) => sum + fc.bps, 0);
  if (totalBps !== 10000) {
    throw new Error(`Total BPS must equal 10000, got ${totalBps}`);
  }

  console.log(`Launching $${params.symbol} with ${params.feeClaimers.length} fee claimers...`);

  // Step 1: Create metadata
  console.log("1/6 Creating metadata...");
  const { tokenMint, tokenMetadata } = await sdk.tokenLaunch.createTokenInfoAndMetadata({
    imageUrl: params.imageUrl,
    name: params.name,
    symbol: params.symbol.toUpperCase().replace("$", ""),
    description: params.description,
    twitter: params.twitter,
    website: params.website,
  });
  console.log(`   Token mint: ${tokenMint}`);

  // Step 2: Resolve fee claimers
  console.log("2/6 Resolving fee claimers...");
  const resolvedClaimers: Array<{ user: PublicKey; userBps: number }> = [];

  for (const fc of params.feeClaimers) {
    let wallet: PublicKey;
    
    if (fc.wallet) {
      wallet = fc.wallet;
      console.log(`   Direct wallet: ${wallet.toBase58()} (${fc.bps / 100}%)`);
    } else if (fc.username && fc.provider) {
      const result = await sdk.state.getLaunchWalletV2(fc.username, fc.provider);
      wallet = result.wallet;
      console.log(`   ${fc.provider}:${fc.username} → ${wallet.toBase58()} (${fc.bps / 100}%)`);
    } else {
      throw new Error("Fee claimer must have either wallet or username+provider");
    }

    resolvedClaimers.push({ user: wallet, userBps: fc.bps });
  }

  // Step 3: Handle lookup tables if needed
  let additionalLookupTables: PublicKey[] | undefined;
  
  if (resolvedClaimers.length > BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT) {
    console.log(`3/6 Creating lookup tables for ${resolvedClaimers.length} claimers...`);
    
    const lutResult = await sdk.config.getConfigCreationLookupTableTransactions({
      payer: keypair.publicKey,
      baseMint: new PublicKey(tokenMint),
      feeClaimers: resolvedClaimers,
    });

    // Execute LUT creation
    await signAndSendTransaction(connection, commitment, lutResult.creationTransaction, keypair);
    
    // CRITICAL: Wait for slot before extending
    console.log("   Waiting for slot...");
    await waitForSlotsToPass(connection, commitment, 1);

    // Execute extend transactions
    for (const extendTx of lutResult.extendTransactions) {
      await signAndSendTransaction(connection, commitment, extendTx, keypair);
    }

    additionalLookupTables = lutResult.lutAddresses;
    console.log(`   Created ${additionalLookupTables.length} lookup tables`);
  } else {
    console.log("3/6 Lookup tables not needed");
  }

  // Step 4: Create fee share config
  console.log("4/6 Creating fee config...");
  const configResult = await sdk.config.createBagsFeeShareConfig({
    payer: keypair.publicKey,
    baseMint: new PublicKey(tokenMint),
    feeClaimers: resolvedClaimers,
    additionalLookupTables,
  });

  if (configResult.bundles?.length) {
    for (const bundle of configResult.bundles) {
      await sendWithJito(bundle);
    }
  }
  for (const tx of configResult.transactions || []) {
    await signAndSendTransaction(connection, commitment, tx, keypair);
  }
  console.log(`   Config key: ${configResult.meteoraConfigKey.toBase58()}`);

  // Step 5: Create launch transaction
  console.log("5/6 Creating launch transaction...");
  const launchTx = await sdk.tokenLaunch.createLaunchTransaction({
    metadataUrl: tokenMetadata,
    tokenMint: new PublicKey(tokenMint),
    launchWallet: keypair.publicKey,
    initialBuyLamports: params.initialBuySol * LAMPORTS_PER_SOL,
    configKey: configResult.meteoraConfigKey,
  });

  // Step 6: Send via Jito
  console.log("6/6 Sending via Jito...");
  const bundleId = await sendWithJito([launchTx]);

  console.log("\n✅ Token launched with fee sharing!");
  console.log(`   Mint: ${tokenMint}`);
  console.log(`   View: https://bags.fm/${tokenMint}`);
  console.log("\n   Fee distribution:");
  for (const fc of params.feeClaimers) {
    const label = fc.wallet ? fc.wallet.toBase58().slice(0, 8) : `${fc.provider}:${fc.username}`;
    console.log(`   - ${label}: ${fc.bps / 100}%`);
  }

  return { tokenMint, tokenMetadata, bundleId };
}

// Example: Creator 50%, two influencers 25% each
launchWithFeeShare({
  name: "Shared Token",
  symbol: "SHARE",
  description: "A token with fee sharing",
  imageUrl: "https://example.com/token.png",
  initialBuySol: 0.01,
  feeClaimers: [
    { wallet: keypair.publicKey, bps: 5000 },           // Creator 50%
    { username: "influencer1", provider: "twitter", bps: 2500 },  // 25%
    { username: "influencer2", provider: "twitter", bps: 2500 },  // 25%
  ],
}).catch(console.error);
