# SDK Methods Reference

Complete reference for `@bagsfm/bags-sdk` methods.

## SDK Initialization

```typescript
import { BagsSDK } from "@bagsfm/bags-sdk";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const connection = new Connection(rpcUrl);
const sdk = new BagsSDK(apiKey: string, connection: Connection, commitment?: "processed" | "confirmed" | "finalized");
```

## Token Launch Service (`sdk.tokenLaunch`)

### createTokenInfoAndMetadata

Creates token metadata and generates the token mint address.

```typescript
const result = await sdk.tokenLaunch.createTokenInfoAndMetadata({
  imageUrl: string,          // URL to token image (required)
  name: string,              // Token name (required)
  symbol: string,            // Token symbol, auto-uppercased, $ stripped (required)
  description: string,       // Token description (required)
  twitter?: string,          // Twitter URL
  website?: string,          // Website URL
  telegram?: string          // Telegram URL
});

// Returns
{
  tokenMint: string,         // Base58 token mint address (SAVE THIS)
  tokenMetadata: string      // IPFS metadata URL
}
```

### createLaunchTransaction

Creates the token launch transaction (already partially signed with mint keypair).

```typescript
const transaction = await sdk.tokenLaunch.createLaunchTransaction({
  metadataUrl: string,           // From createTokenInfoAndMetadata
  tokenMint: PublicKey,          // From createTokenInfoAndMetadata (convert to PublicKey)
  launchWallet: PublicKey,       // Creator's wallet
  initialBuyLamports: number,    // Initial buy amount in lamports
  configKey: PublicKey           // From createBagsFeeShareConfig
});

// Returns: VersionedTransaction (needs signing + Jito bundling)
```

## Config Service (`sdk.config`)

### createBagsFeeShareConfig

Creates fee sharing configuration for a token.

```typescript
const result = await sdk.config.createBagsFeeShareConfig({
  payer: PublicKey,                           // Wallet paying for config creation
  baseMint: PublicKey,                        // Token mint address
  feeClaimers: Array<{
    user: PublicKey,                          // Wallet to receive fees
    userBps: number                           // Basis points (10000 = 100%)
  }>,
  partner?: PublicKey,                        // Optional: Partner wallet
  partnerConfig?: PublicKey,                  // Optional: Partner config PDA
  additionalLookupTables?: PublicKey[]        // Required if >15 claimers
});

// Returns
{
  meteoraConfigKey: PublicKey,     // Config key for launch tx (SAVE THIS)
  transactions: VersionedTransaction[],  // Sign and send these
  bundles?: VersionedTransaction[][]      // Send via Jito if present
}
```

### getConfigCreationLookupTableTransactions

Required when >15 fee claimers. Creates lookup tables to fit all addresses in transaction.

```typescript
const lutResult = await sdk.config.getConfigCreationLookupTableTransactions({
  payer: PublicKey,
  baseMint: PublicKey,
  feeClaimers: Array<{ user: PublicKey, userBps: number }>
});

// Returns
{
  creationTransaction: VersionedTransaction,  // Execute first
  extendTransactions: VersionedTransaction[], // Execute after waiting 1 slot
  lutAddresses: PublicKey[]                   // Pass to createBagsFeeShareConfig
}

// IMPORTANT: Must wait 1 slot between creation and extend
await signAndSendTransaction(connection, commitment, lutResult.creationTransaction, keypair);
await waitForSlotsToPass(connection, commitment, 1);  // Critical!
for (const extendTx of lutResult.extendTransactions) {
  await signAndSendTransaction(connection, commitment, extendTx, keypair);
}
```

## Fee Service (`sdk.fee`)

### getAllClaimablePositions

Gets all positions with claimable fees for a wallet.

```typescript
const positions = await sdk.fee.getAllClaimablePositions(wallet: PublicKey);

// Returns Array of:
{
  baseMint: string,                          // Token mint
  virtualPoolAddress: string,                // Virtual pool address
  virtualPoolClaimableAmount?: string,       // Lamports claimable from virtual pool
  dammPoolClaimableAmount?: string,          // Lamports claimable from DAMM v2
  isCustomFeeVault: boolean,                 // True if using fee share program
  customFeeVaultBalance?: number,            // Vault balance in lamports
  customFeeVaultBps?: number,                // Your share in BPS
  customFeeVaultClaimerSide?: 'A' | 'B',     // Which claimer slot you're in
  isMigrated?: boolean,                      // True if token graduated to DAMM v2
  programId?: string,                        // Fee share program ID (v1 or v2)
  userBps?: number,                          // Your BPS (v2 only)
  claimerIndex?: number                      // Your index in claimers array (v2 only)
}
```

### getClaimTransaction

Generates claim transactions for a specific position.

```typescript
const transactions = await sdk.fee.getClaimTransaction(
  wallet: PublicKey,
  position: ClaimablePosition  // From getAllClaimablePositions
);

// Returns: VersionedTransaction[] (sign and send each)
```

## Partner Service (`sdk.partner`)

### getPartnerConfigCreationTransaction

Creates a partner key for platform economics.

```typescript
const { transaction, blockhash } = await sdk.partner.getPartnerConfigCreationTransaction(
  partnerWallet: PublicKey
);

// Returns
{
  transaction: VersionedTransaction,
  blockhash: string
}
```

### getPartnerConfig

Gets existing partner configuration.

```typescript
const config = await sdk.partner.getPartnerConfig(partnerWallet: PublicKey);

// Returns
{
  partner: PublicKey,
  bps: number,              // Usually 2500 (25%)
  totalClaimedFees: BN
}
```

### getPartnerConfigClaimStats

Gets partner fee claiming statistics.

```typescript
const stats = await sdk.partner.getPartnerConfigClaimStats(partnerWallet: PublicKey);

// Returns
{
  claimedFees: string,      // Lamports claimed (as string for bigint)
  unclaimedFees: string     // Lamports unclaimed
}
```

### getPartnerClaimTransactions

Generates transactions to claim partner fees.

```typescript
const transactions = await sdk.partner.getPartnerClaimTransactions(partnerWallet: PublicKey);

// Returns: VersionedTransaction[] (sign and send each)
```

## Trade Service (`sdk.trade`)

### getQuote

Gets a quote for token swap.

```typescript
const quote = await sdk.trade.getQuote({
  inputMint: PublicKey,              // Token to swap from
  outputMint: PublicKey,             // Token to swap to
  amount: number,                    // Amount in smallest unit (lamports for SOL)
  slippageMode: "auto" | "manual",   // Auto recommended
  slippageBps?: number               // Required if manual (100 = 1%)
});

// Returns
{
  requestId: string,
  inAmount: string,
  outAmount: string,
  minOutAmount: string,              // Considering slippage
  priceImpactPct: string,
  slippageBps: number,
  routePlan: Array<{
    venue: string,
    inputMint: string,
    outputMint: string,
    inAmount: string,
    outAmount: string
  }>,
  platformFee?: {
    amount: string,
    feeBps: number,
    feeAccount: string
  }
}
```

### createSwapTransaction

Creates swap transaction from quote.

```typescript
const result = await sdk.trade.createSwapTransaction({
  quoteResponse: QuoteResponse,      // From getQuote
  userPublicKey: PublicKey           // Wallet executing swap
});

// Returns
{
  transaction: VersionedTransaction,
  computeUnitLimit: number,
  lastValidBlockHeight: number,
  prioritizationFeeLamports: number
}
```

## State Service (`sdk.state`)

### getTokenLifetimeFees

Gets total fees earned by a token.

```typescript
const feesLamports = await sdk.state.getTokenLifetimeFees(tokenMint: PublicKey);
// Returns: number (lamports)
```

### getLaunchWalletV2

Resolves social username to wallet address for fee sharing.

```typescript
const result = await sdk.state.getLaunchWalletV2(
  username: string,
  provider: "twitter" | "kick" | "github"
);

// Returns
{
  wallet: PublicKey
}
```

### getConnection / getCommitment

Access SDK state.

```typescript
const connection = sdk.state.getConnection();
const commitment = sdk.state.getCommitment();
```

## Solana Service (`sdk.solana`)

### getJitoRecentFees

Gets recommended Jito tip amounts.

```typescript
const fees = await sdk.solana.getJitoRecentFees();

// Returns
{
  landed_tips_95th_percentile: number  // SOL amount for 95th percentile tip
}
```

## Utility Functions (Exported from SDK)

```typescript
import {
  signAndSendTransaction,
  waitForSlotsToPass,
  createTipTransaction,
  sendBundleAndConfirm,
  deriveBagsFeeShareV2PartnerConfigPda,
  BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT  // = 15
} from "@bagsfm/bags-sdk";

// Sign and send a transaction
await signAndSendTransaction(
  connection: Connection,
  commitment: string,
  transaction: VersionedTransaction,
  keypair: Keypair,
  blockhash?: string
);

// Wait for Solana slots (required after LUT creation)
await waitForSlotsToPass(connection: Connection, commitment: string, slots: number);

// Create Jito tip transaction
const tipTx = await createTipTransaction(
  connection: Connection,
  commitment: string,
  payer: PublicKey,
  tipLamports: number,
  options?: { blockhash?: string }
);

// Send bundle via Jito and wait for confirmation
const bundleId = await sendBundleAndConfirm(
  transactions: VersionedTransaction[],  // Tip tx should be first
  sdk: BagsSDK
);

// Derive partner config PDA
const partnerConfigPda = deriveBagsFeeShareV2PartnerConfigPda(partnerWallet: PublicKey);
```

## Constants

```typescript
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT } from "@bagsfm/bags-sdk";

// LAMPORTS_PER_SOL = 1_000_000_000 (1 SOL = 1B lamports)
// BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT = 15 (max claimers without LUT)
```
