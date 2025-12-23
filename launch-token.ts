/**
 * Basic Token Launch Script
 * Launches a token with all fees going to the creator.
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
} from "@bagsfm/bags-sdk";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

// Validate environment
const BAGS_API_KEY = process.env.BAGS_API_KEY;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!BAGS_API_KEY || !SOLANA_RPC_URL || !PRIVATE_KEY) {
  throw new Error("Missing required environment variables: BAGS_API_KEY, SOLANA_RPC_URL, PRIVATE_KEY");
}

// Initialize
const connection = new Connection(SOLANA_RPC_URL);
const sdk = new BagsSDK(BAGS_API_KEY, connection, "processed");
const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));

const FALLBACK_JITO_TIP = 0.015 * LAMPORTS_PER_SOL;

/**
 * Send transactions via Jito bundler with tip
 */
async function sendWithJito(transactions: VersionedTransaction[]): Promise<string> {
  const commitment = sdk.state.getCommitment();
  const blockhash = transactions[0]?.message.recentBlockhash;
  
  if (!blockhash) throw new Error("Transaction missing blockhash");

  // Get recommended tip
  let tipLamports = FALLBACK_JITO_TIP;
  try {
    const jitoFees = await sdk.solana.getJitoRecentFees();
    if (jitoFees?.landed_tips_95th_percentile) {
      tipLamports = Math.floor(jitoFees.landed_tips_95th_percentile * LAMPORTS_PER_SOL);
    }
  } catch (e) {
    console.log("Using fallback Jito tip");
  }

  // Create tip transaction
  const tipTx = await createTipTransaction(connection, commitment, keypair.publicKey, tipLamports, { blockhash });

  // Sign all transactions
  const signedTxs = [tipTx, ...transactions].map(tx => {
    tx.sign([keypair]);
    return tx;
  });

  // Send bundle
  return await sendBundleAndConfirm(signedTxs, sdk);
}

/**
 * Launch a token with all fees to creator
 */
async function launchToken(params: {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  initialBuySol: number;
  twitter?: string;
  website?: string;
  telegram?: string;
}) {
  const commitment = sdk.state.getCommitment();
  
  console.log(`Launching $${params.symbol}...`);

  // Step 1: Create metadata
  console.log("1/5 Creating metadata...");
  const { tokenMint, tokenMetadata } = await sdk.tokenLaunch.createTokenInfoAndMetadata({
    imageUrl: params.imageUrl,
    name: params.name,
    symbol: params.symbol.toUpperCase().replace("$", ""),
    description: params.description,
    twitter: params.twitter,
    website: params.website,
    telegram: params.telegram,
  });
  console.log(`   Token mint: ${tokenMint}`);

  // Step 2: Create fee share config (all to creator)
  console.log("2/5 Creating fee config...");
  const feeClaimers = [{ user: keypair.publicKey, userBps: 10000 }];
  
  const configResult = await sdk.config.createBagsFeeShareConfig({
    payer: keypair.publicKey,
    baseMint: new PublicKey(tokenMint),
    feeClaimers,
  });

  // Execute config transactions
  if (configResult.bundles?.length) {
    for (const bundle of configResult.bundles) {
      await sendWithJito(bundle);
    }
  }
  for (const tx of configResult.transactions || []) {
    await signAndSendTransaction(connection, commitment, tx, keypair);
  }
  console.log(`   Config key: ${configResult.meteoraConfigKey.toBase58()}`);

  // Step 3: Create launch transaction
  console.log("3/5 Creating launch transaction...");
  const launchTx = await sdk.tokenLaunch.createLaunchTransaction({
    metadataUrl: tokenMetadata,
    tokenMint: new PublicKey(tokenMint),
    launchWallet: keypair.publicKey,
    initialBuyLamports: params.initialBuySol * LAMPORTS_PER_SOL,
    configKey: configResult.meteoraConfigKey,
  });

  // Step 4 & 5: Sign and send via Jito
  console.log("4/5 Signing...");
  console.log("5/5 Sending via Jito...");
  const bundleId = await sendWithJito([launchTx]);

  console.log("\n✅ Token launched!");
  console.log(`   Mint: ${tokenMint}`);
  console.log(`   Bundle: ${bundleId}`);
  console.log(`   View: https://bags.fm/${tokenMint}`);

  return { tokenMint, tokenMetadata, bundleId };
}

// Execute
launchToken({
  name: "My Token",
  symbol: "MTK",
  description: "A token launched via Bags API",
  imageUrl: "https://example.com/token-image.png",  // Replace with actual image URL
  initialBuySol: 0.01,
  twitter: "https://x.com/mytoken",
  website: "https://mytoken.com",
}).catch(console.error);
