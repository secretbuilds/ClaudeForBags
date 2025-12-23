---
name: bags-api
description: Build Solana token launches with fee sharing, trading, and partner economics using the Bags API and TypeScript SDK. Use when the user wants to: (1) Launch Solana tokens programmatically, (2) Configure fee sharing between wallets, (3) Build launchpads or platforms that earn partner fees, (4) Trade/swap tokens via API, (5) Claim accumulated fees, (6) Query token analytics. Triggers on mentions of Bags, bags.fm, token launches with revenue sharing, Solana token creation with fee splits, or building crypto launchpads.
---

# Bags API Skill

## Overview

Bags is a Solana token launchpad with programmable fee sharing. The API enables token creation, fee distribution among up to 100 wallets, partner key economics for platform builders, and trading.

**Base URL:** `https://public-api-v2.bags.fm/api/v1/`
**SDK:** `@bagsfm/bags-sdk` (always prefer SDK over raw API calls)
**Auth:** API key in `x-api-key` header (get from dev.bags.fm)
**Rate Limit:** 1,000 requests/hour per user

## Decision Tree

| User Intent | Read | Use Script |
|-------------|------|------------|
| Launch a basic token | references/sdk-methods.md → Token Launch section | scripts/launch-token.ts |
| Launch with fee sharing | references/fee-sharing.md (critical) + sdk-methods.md | scripts/launch-with-fee-share.ts |
| Build a launchpad/platform | references/patterns.md → Launchpad + fee-sharing.md | scripts/create-partner-key.ts |
| Trade/swap tokens | references/sdk-methods.md → Trade section | scripts/trade-tokens.ts |
| Claim fees | references/sdk-methods.md → Fee Claiming section | scripts/claim-fees.ts |
| Query token data | references/sdk-methods.md → State section | (inline code) |
| Understand API limits | references/api-endpoints.md | — |

## Critical Constraints (Memorize These)

### Fee Share v2 Rules
1. **Creator BPS must be explicit** — Creator does NOT get implicit remainder. Must set `{ user: creatorWallet, userBps: X }` in feeClaimers array
2. **Total BPS must equal exactly 10,000** — No more, no less. 10,000 = 100%
3. **Max 100 fee claimers per token** — Including the creator
4. **>15 claimers requires lookup tables** — SDK handles this automatically via `getConfigCreationLookupTableTransactions()`

### Partner Keys
1. **One partner key per wallet** — Need multiple? Use multiple wallets
2. **Default 25% (2,500 BPS)** — Partner gets 25% of fees from tokens launched via their key
3. **Partner fees are separate** — Claimed via `getPartnerClaimTransactions()`, not regular fee claiming

### General
1. **Always use SDK** — Raw API returns unsigned transactions; SDK handles signing, bundling, Jito tips
2. **Jito bundling required for launches** — SDK's `sendBundleWithTip()` handles this
3. **RPC commitment: "processed"** — SDK default, fastest confirmation
4. **Token mint is generated during metadata creation** — Not during launch tx

## Environment Setup

```typescript
// Required .env
BAGS_API_KEY=your_api_key_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
PRIVATE_KEY=your_base58_encoded_private_key  // Export from Phantom/Backpack

// SDK initialization pattern
import { BagsSDK } from "@bagsfm/bags-sdk";
import { Connection } from "@solana/web3.js";

const connection = new Connection(process.env.SOLANA_RPC_URL!);
const sdk = new BagsSDK(process.env.BAGS_API_KEY!, connection, "processed");
```

## Required Dependencies

```bash
npm install @bagsfm/bags-sdk @solana/web3.js bs58 dotenv
```

## Token Launch Flow (5 Steps)

1. **Create metadata** → `sdk.tokenLaunch.createTokenInfoAndMetadata()` → Returns tokenMint + metadataUrl
2. **Build fee claimers array** → Must include creator with explicit BPS
3. **Create fee share config** → `sdk.config.createBagsFeeShareConfig()` → Returns meteoraConfigKey
4. **Create launch transaction** → `sdk.tokenLaunch.createLaunchTransaction()`
5. **Bundle and send via Jito** → `sendBundleWithTip()` with tip transaction

## What Bags CANNOT Do

- **No automatic buybacks** — Must build: claim fees → swap to token → burn/hold
- **No holder dividends** — Fee sharing is wallet-to-wallet, not token-holder-based
- **No liquidity locking** — Use external protocols (Streamflow, etc.)
- **No governance** — No voting/proposal mechanisms
- **No vesting** — No built-in token vesting schedules

## Common Mistakes to Avoid

1. ❌ Forgetting to include creator in feeClaimers with explicit BPS
2. ❌ Assuming BPS remainder goes to creator (it doesn't — must be explicit)
3. ❌ Using raw API instead of SDK for transactions
4. ❌ Not waiting for slot to pass after LUT creation (`waitForSlotsToPass()`)
5. ❌ Sending launch tx without Jito bundling
6. ❌ Using wrong commitment level (stick with "processed")

## Quick Patterns

### All fees to creator (default)
```typescript
const feeClaimers = [{ user: creatorWallet, userBps: 10000 }];
```

### 50/50 split with one partner
```typescript
const feeClaimers = [
  { user: creatorWallet, userBps: 5000 },
  { user: partnerWallet, userBps: 5000 }
];
```

### Platform takes 25% via partner key
```typescript
// Platform creates partner key once
const partnerConfigPda = deriveBagsFeeShareV2PartnerConfigPda(platformWallet);

// Include in every token launch
await sdk.config.createBagsFeeShareConfig({
  payer: creatorWallet,
  baseMint: tokenMint,
  feeClaimers: [...],
  partner: platformWallet,
  partnerConfig: partnerConfigPda
});
```

## Reference Files

- `references/sdk-methods.md` — All SDK method signatures, parameters, return types
- `references/fee-sharing.md` — Deep dive on BPS math, fee share v1 vs v2, claiming
- `references/api-endpoints.md` — Raw API endpoints for edge cases
- `references/patterns.md` — Strategic patterns: launchpad, treasury, revenue share

## Script Files

- `scripts/launch-token.ts` — Basic token launch (all fees to creator)
- `scripts/launch-with-fee-share.ts` — Launch with fee sharing
- `scripts/create-partner-key.ts` — Create partner configuration
- `scripts/claim-fees.ts` — Claim accumulated fees
- `scripts/trade-tokens.ts` — Get quotes and execute swaps
