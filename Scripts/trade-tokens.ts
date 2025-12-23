/**
 * Trade Tokens Script
 * Get quotes and execute swaps via Bags API.
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

// Common token mints
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/**
 * Get a quote for a swap
 */
async function getQuote(params: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;  // In smallest unit (lamports for SOL)
  slippageMode?: "auto" | "manual";
  slippageBps?: number;  // Required if manual (100 = 1%)
}) {
  console.log("Getting quote...");
  console.log(`  Input: ${params.inputMint.toBase58()}`);
  console.log(`  Output: ${params.outputMint.toBase58()}`);
  console.log(`  Amount: ${params.amount}`);

  const quote = await sdk.trade.getQuote({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageMode: params.slippageMode || "auto",
    slippageBps: params.slippageBps,
  });

  console.log("\n📊 Quote:");
  console.log(`  In: ${quote.inAmount}`);
  console.log(`  Out: ${quote.outAmount}`);
  console.log(`  Min out (with slippage): ${quote.minOutAmount}`);
  console.log(`  Price impact: ${quote.priceImpactPct}%`);
  console.log(`  Slippage: ${quote.slippageBps / 100}%`);

  if (quote.routePlan.length > 0) {
    console.log(`  Route: ${quote.routePlan.length} hop(s)`);
    quote.routePlan.forEach((leg, i) => {
      console.log(`    ${i + 1}. ${leg.venue}: ${leg.inAmount} → ${leg.outAmount}`);
    });
  }

  return quote;
}

/**
 * Execute a swap
 */
async function executeSwap(params: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;
  slippageMode?: "auto" | "manual";
  slippageBps?: number;
}) {
  const commitment = sdk.state.getCommitment();

  // Get quote
  const quote = await getQuote(params);

  // Create swap transaction
  console.log("\nCreating swap transaction...");
  const { transaction, computeUnitLimit, prioritizationFeeLamports } = await sdk.trade.createSwapTransaction({
    quoteResponse: quote,
    userPublicKey: keypair.publicKey,
  });

  console.log(`  Compute units: ${computeUnitLimit}`);
  console.log(`  Priority fee: ${prioritizationFeeLamports} lamports`);

  // Execute
  console.log("\nExecuting swap...");
  const signature = await signAndSendTransaction(connection, commitment, transaction, keypair);

  console.log("\n✅ Swap executed!");
  console.log(`  Signature: ${signature}`);
  console.log(`  Explorer: https://solscan.io/tx/${signature}`);

  return { signature, quote };
}

/**
 * Buy tokens with SOL
 */
async function buyWithSol(tokenMint: PublicKey, solAmount: number) {
  console.log(`Buying ${tokenMint.toBase58().slice(0, 8)}... with ${solAmount} SOL\n`);

  return executeSwap({
    inputMint: SOL_MINT,
    outputMint: tokenMint,
    amount: Math.floor(solAmount * LAMPORTS_PER_SOL),
  });
}

/**
 * Sell tokens for SOL
 */
async function sellForSol(tokenMint: PublicKey, tokenAmount: number, decimals: number = 9) {
  console.log(`Selling ${tokenAmount} of ${tokenMint.toBase58().slice(0, 8)}... for SOL\n`);

  return executeSwap({
    inputMint: tokenMint,
    outputMint: SOL_MINT,
    amount: Math.floor(tokenAmount * Math.pow(10, decimals)),
  });
}

/**
 * Quote only (no execution)
 */
async function quoteOnly(inputMint: PublicKey, outputMint: PublicKey, amount: number) {
  const quote = await getQuote({ inputMint, outputMint, amount });
  return quote;
}

// Main execution
async function main() {
  const action = process.argv[2] || "help";
  
  switch (action) {
    case "buy": {
      // npx ts-node trade-tokens.ts buy <TOKEN_MINT> <SOL_AMOUNT>
      const tokenMint = process.argv[3];
      const solAmount = parseFloat(process.argv[4] || "0.01");
      
      if (!tokenMint) {
        console.log("Usage: npx ts-node trade-tokens.ts buy <TOKEN_MINT> <SOL_AMOUNT>");
        return;
      }
      
      await buyWithSol(new PublicKey(tokenMint), solAmount);
      break;
    }
    
    case "sell": {
      // npx ts-node trade-tokens.ts sell <TOKEN_MINT> <TOKEN_AMOUNT> [DECIMALS]
      const tokenMint = process.argv[3];
      const tokenAmount = parseFloat(process.argv[4] || "1");
      const decimals = parseInt(process.argv[5] || "9");
      
      if (!tokenMint) {
        console.log("Usage: npx ts-node trade-tokens.ts sell <TOKEN_MINT> <TOKEN_AMOUNT> [DECIMALS]");
        return;
      }
      
      await sellForSol(new PublicKey(tokenMint), tokenAmount, decimals);
      break;
    }
    
    case "quote": {
      // npx ts-node trade-tokens.ts quote <INPUT_MINT> <OUTPUT_MINT> <AMOUNT>
      const inputMint = process.argv[3];
      const outputMint = process.argv[4];
      const amount = parseInt(process.argv[5] || "1000000");
      
      if (!inputMint || !outputMint) {
        console.log("Usage: npx ts-node trade-tokens.ts quote <INPUT_MINT> <OUTPUT_MINT> <AMOUNT>");
        return;
      }
      
      await quoteOnly(new PublicKey(inputMint), new PublicKey(outputMint), amount);
      break;
    }
    
    default:
      console.log("Usage:");
      console.log("  npx ts-node trade-tokens.ts buy <TOKEN_MINT> <SOL_AMOUNT>");
      console.log("  npx ts-node trade-tokens.ts sell <TOKEN_MINT> <TOKEN_AMOUNT> [DECIMALS]");
      console.log("  npx ts-node trade-tokens.ts quote <INPUT_MINT> <OUTPUT_MINT> <AMOUNT>");
      console.log("\nExamples:");
      console.log("  npx ts-node trade-tokens.ts buy ABC123... 0.1       # Buy with 0.1 SOL");
      console.log("  npx ts-node trade-tokens.ts sell ABC123... 1000 6   # Sell 1000 tokens (6 decimals)");
  }
}

main().catch(console.error);
