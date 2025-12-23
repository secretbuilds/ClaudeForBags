# Fee Sharing Reference

Deep dive on Bags Fee Share v2 — the most error-prone part of the API.

## Core Concept

When a token is traded on Bags, trading fees are generated. Fee Share v2 allows these fees to be split among up to 100 wallets using basis points (BPS) allocation.

## BPS (Basis Points) Math

```
10,000 BPS = 100%
1,000 BPS = 10%
100 BPS = 1%
25 BPS = 0.25%
1 BPS = 0.01%
```

**Total BPS must equal exactly 10,000.** Not 9,999, not 10,001.

## Critical Rule: Creator Must Be Explicit

Unlike other systems where "remainder goes to creator," Bags requires **explicit BPS for the creator**.

### ❌ WRONG — Will Fail
```typescript
// Creator not included — fails validation
const feeClaimers = [
  { user: influencer1, userBps: 3000 },
  { user: influencer2, userBps: 3000 }
];
// Total = 6000, missing 4000 — WHERE DOES IT GO? Nowhere. Fails.
```

### ✅ CORRECT — Creator Explicit
```typescript
const feeClaimers = [
  { user: creatorWallet, userBps: 4000 },  // Creator gets 40%
  { user: influencer1, userBps: 3000 },     // 30%
  { user: influencer2, userBps: 3000 }      // 30%
];
// Total = 10000 ✓
```

### ✅ CORRECT — All to Creator
```typescript
const feeClaimers = [
  { user: creatorWallet, userBps: 10000 }  // Creator gets 100%
];
```

## Fee Claimer Resolution

Fee claimers can be identified by social username. The SDK resolves to wallet address:

```typescript
// Supported providers: "twitter", "kick", "github"
const result = await sdk.state.getLaunchWalletV2("elonmusk", "twitter");
const influencerWallet = result.wallet;

// Then use in feeClaimers
feeClaimers.push({ user: influencerWallet, userBps: 2000 });
```

**User must have linked their wallet on bags.fm for resolution to work.**

## Lookup Tables (>15 Claimers)

Solana transactions have size limits. With >15 fee claimers, addresses don't fit in one transaction. Lookup Tables (LUTs) compress addresses.

### Automatic Handling
```typescript
import { BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT } from "@bagsfm/bags-sdk";

if (feeClaimers.length > BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT) {
  // Step 1: Get LUT transactions
  const lutResult = await sdk.config.getConfigCreationLookupTableTransactions({
    payer: creatorWallet,
    baseMint: tokenMint,
    feeClaimers
  });

  // Step 2: Execute LUT creation
  await signAndSendTransaction(connection, commitment, lutResult.creationTransaction, keypair);

  // Step 3: CRITICAL — Wait for 1 slot before extending
  await waitForSlotsToPass(connection, commitment, 1);

  // Step 4: Execute all extend transactions
  for (const extendTx of lutResult.extendTransactions) {
    await signAndSendTransaction(connection, commitment, extendTx, keypair);
  }

  // Step 5: Pass LUT addresses to config creation
  const configResult = await sdk.config.createBagsFeeShareConfig({
    payer: creatorWallet,
    baseMint: tokenMint,
    feeClaimers,
    additionalLookupTables: lutResult.lutAddresses  // <-- Required
  });
}
```

### Why Wait 1 Slot?
Solana requires LUT to be "warmed up" before extension. Skipping the wait causes transaction failure.

## Partner Keys vs Fee Claimers

| Aspect | Fee Claimers | Partner Keys |
|--------|--------------|--------------|
| Purpose | Share token fees with wallets | Platform takes cut of ALL launches |
| BPS Source | From the 10,000 token fee pool | Separate 25% on top |
| One-time setup | Per token | Per platform wallet |
| Claiming | `sdk.fee.getClaimTransaction()` | `sdk.partner.getPartnerClaimTransactions()` |

### How Partner Keys Work
1. Platform creates partner key (once): `sdk.partner.getPartnerConfigCreationTransaction()`
2. Platform includes partner config in every token launch
3. Partner automatically receives 25% of all fees from those tokens
4. Partner claims separately from regular fee claimers

```typescript
// Platform setup (once)
const partnerConfigPda = deriveBagsFeeShareV2PartnerConfigPda(platformWallet);

// Include in every token launch
await sdk.config.createBagsFeeShareConfig({
  ...config,
  partner: platformWallet,
  partnerConfig: partnerConfigPda
});
```

## Fee Share v1 vs v2

| v1 (Legacy) | v2 (Current) |
|-------------|--------------|
| 2 claimers max (A/B) | Up to 100 claimers |
| Fixed split | Flexible BPS |
| `customFeeVaultClaimerA/B` | `feeClaimers` array |
| Still works for old tokens | Required for new launches |

**Always use v2 for new tokens.**

## Token Lifecycle and Fees

```
[Launch] → [Virtual Pool Trading] → [Migration] → [DAMM v2 Trading]
              ↓                         ↓              ↓
        Virtual pool fees           Snapshot      DAMM v2 fees
```

1. **Virtual Pool**: Pre-graduation trading generates fees
2. **Migration**: Token "graduates" to DAMM v2 when conditions met
3. **DAMM v2**: Post-graduation trading generates fees

Claimable positions may include both virtual pool and DAMM v2 fees.

## Claiming Fees

### Get All Claimable Positions
```typescript
const positions = await sdk.fee.getAllClaimablePositions(wallet);

for (const position of positions) {
  console.log(`Token: ${position.baseMint}`);
  console.log(`Virtual Pool: ${position.virtualPoolClaimableAmount} lamports`);
  console.log(`DAMM v2: ${position.dammPoolClaimableAmount} lamports`);
}
```

### Claim for Specific Token
```typescript
const targetPositions = positions.filter(p => p.baseMint === targetMint);

for (const position of targetPositions) {
  const claimTxs = await sdk.fee.getClaimTransaction(wallet, position);
  for (const tx of claimTxs) {
    await signAndSendTransaction(connection, commitment, tx, keypair);
  }
}
```

## Common Patterns

### DAO Treasury (Creator keeps all, distributes manually)
```typescript
const feeClaimers = [{ user: daoTreasury, userBps: 10000 }];
// DAO later distributes via governance
```

### Creator + 2 Influencers
```typescript
const feeClaimers = [
  { user: creatorWallet, userBps: 5000 },  // 50%
  { user: influencer1, userBps: 2500 },     // 25%
  { user: influencer2, userBps: 2500 }      // 25%
];
```

### Platform + Creator
```typescript
// Platform uses partner key (25% automatic)
// Creator gets remaining fee pool
const feeClaimers = [{ user: creatorWallet, userBps: 10000 }];
// Platform's 25% comes from partner config, not from this 10000
```

### Community Distribution (10 wallets)
```typescript
const communityWallets = [...]; // 10 addresses
const feeClaimers = communityWallets.map(wallet => ({
  user: wallet,
  userBps: 1000  // 10% each = 100% total
}));
```

## Error Messages and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| "Total BPS must equal 10000" | BPS don't sum to 10000 | Recalculate to sum exactly 10000 |
| "Creator must be included" | Creator wallet missing from feeClaimers | Add creator with explicit BPS |
| "Too many fee claimers" | >100 claimers | Reduce to 100 max |
| "Lookup table not found" | Skipped LUT creation for >15 claimers | Create LUTs first |
| "Account not found" | Social username not linked to wallet | User must link wallet on bags.fm |
