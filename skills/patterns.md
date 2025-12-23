# Strategic Patterns

Architectural patterns for sophisticated Bags API use cases beyond simple token launches.

## Pattern 1: Launchpad Platform

**Goal:** Build a platform where others launch tokens, you earn fees on every launch.

### Architecture
```
[Your Platform] → Partner Key (25% of all fees)
       ↓
[Creator A launches] → Token A fees → 25% to you
[Creator B launches] → Token B fees → 25% to you
[Creator C launches] → Token C fees → 25% to you
```

### Implementation

```typescript
// ONE-TIME: Create your platform's partner key
const platformWallet = new PublicKey("YOUR_PLATFORM_WALLET");
const { transaction } = await sdk.partner.getPartnerConfigCreationTransaction(platformWallet);
await signAndSendTransaction(connection, commitment, transaction, platformKeypair);

const partnerConfigPda = deriveBagsFeeShareV2PartnerConfigPda(platformWallet);
// Store partnerConfigPda — use for all launches

// FOR EVERY LAUNCH: Include partner config
async function launchTokenForCreator(creatorWallet, tokenDetails) {
  const { tokenMint, tokenMetadata } = await sdk.tokenLaunch.createTokenInfoAndMetadata(tokenDetails);
  
  // Creator gets all fees (100%) from their perspective
  // But partner key automatically takes 25% off the top
  const feeClaimers = [{ user: creatorWallet, userBps: 10000 }];
  
  const configResult = await sdk.config.createBagsFeeShareConfig({
    payer: creatorWallet,
    baseMint: new PublicKey(tokenMint),
    feeClaimers,
    partner: platformWallet,        // Your platform
    partnerConfig: partnerConfigPda // Your partner PDA
  });
  
  // Continue with launch...
}

// PERIODIC: Claim your platform fees
async function claimPlatformFees() {
  const stats = await sdk.partner.getPartnerConfigClaimStats(platformWallet);
  console.log(`Unclaimed: ${Number(stats.unclaimedFees) / LAMPORTS_PER_SOL} SOL`);
  
  const claimTxs = await sdk.partner.getPartnerClaimTransactions(platformWallet);
  for (const tx of claimTxs) {
    await signAndSendTransaction(connection, commitment, tx, platformKeypair);
  }
}
```

### Economics
- Platform gets 25% of trading fees from ALL tokens launched via your platform
- Creators still get their full share (100% of remaining 75%)
- No ongoing maintenance — fees accumulate automatically

---

## Pattern 2: Treasury Accumulation + Buyback

**Goal:** Accumulate fees in treasury, periodically buy back and burn tokens.

### Architecture
```
[Token Trading] → Fees accumulate in treasury wallet
                         ↓
              [Buyback Bot] (manual or automated)
                         ↓
              [Swap SOL → Token] → [Burn or Hold]
```

### Implementation

```typescript
// LAUNCH: All fees to treasury
const treasuryWallet = new PublicKey("TREASURY_WALLET");
const feeClaimers = [{ user: treasuryWallet, userBps: 10000 }];

// PERIODIC BUYBACK
async function executeBuyback(tokenMint: PublicKey, solAmount: number) {
  // 1. Claim accumulated fees
  const positions = await sdk.fee.getAllClaimablePositions(treasuryWallet);
  const targetPositions = positions.filter(p => p.baseMint === tokenMint.toBase58());
  
  for (const position of targetPositions) {
    const claimTxs = await sdk.fee.getClaimTransaction(treasuryWallet, position);
    for (const tx of claimTxs) {
      await signAndSendTransaction(connection, commitment, tx, treasuryKeypair);
    }
  }
  
  // 2. Swap SOL to token
  const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const quote = await sdk.trade.getQuote({
    inputMint: SOL_MINT,
    outputMint: tokenMint,
    amount: solAmount * LAMPORTS_PER_SOL,
    slippageMode: "auto"
  });
  
  const { transaction } = await sdk.trade.createSwapTransaction({
    quoteResponse: quote,
    userPublicKey: treasuryWallet
  });
  
  await signAndSendTransaction(connection, commitment, transaction, treasuryKeypair);
  
  // 3. Burn tokens (requires token program burn instruction — not Bags API)
  // Or hold in treasury for future distribution
}

// Schedule: Run daily/weekly via cron
```

### Considerations
- Bags doesn't have built-in burn — use Solana token program
- Consider slippage on large buybacks
- Track buyback history for transparency

---

## Pattern 3: Revenue Share DAO

**Goal:** DAO members receive proportional fee share based on governance tokens.

### Architecture
```
[Token Trading] → Fees to DAO treasury
                         ↓
              [Governance Snapshot]
                         ↓
              [Distribute to holders] (off-chain/on-chain)
```

### Implementation Options

**Option A: Fixed Wallets (Simple)**
```typescript
// Pre-defined DAO members with fixed shares
const daoMembers = [
  { wallet: member1, bps: 2000 },  // 20%
  { wallet: member2, bps: 2000 },
  { wallet: member3, bps: 2000 },
  { wallet: member4, bps: 2000 },
  { wallet: member5, bps: 2000 }   // 100% total
];

const feeClaimers = daoMembers.map(m => ({
  user: new PublicKey(m.wallet),
  userBps: m.bps
}));
```

**Option B: Treasury + Manual Distribution (Flexible)**
```typescript
// All fees to DAO treasury
const feeClaimers = [{ user: daoTreasury, userBps: 10000 }];

// Separately: Governance votes on distribution
// Execute distribution via multisig or governance proposal
```

**Option C: Dynamic via Merkle Claims (Advanced)**
```
// Not natively supported by Bags
// Would require custom smart contract that:
// 1. Receives fees from Bags
// 2. Takes governance token snapshot
// 3. Creates Merkle tree for proportional claims
```

### Limitation
Bags fee sharing is wallet-to-wallet, not token-holder-based. True "dividend to all holders" requires custom contract or off-chain distribution.

---

## Pattern 4: Influencer Revenue Split

**Goal:** Creator + influencers share fees automatically.

### Implementation

```typescript
async function launchWithInfluencers(
  creatorWallet: PublicKey,
  influencers: Array<{ username: string; provider: "twitter" | "kick" | "github"; bps: number }>,
  tokenDetails: any
) {
  // Calculate creator's share (remainder)
  const influencerBps = influencers.reduce((sum, i) => sum + i.bps, 0);
  const creatorBps = 10000 - influencerBps;
  
  if (creatorBps < 0) throw new Error("Influencer BPS exceeds 100%");
  
  // Resolve influencer wallets
  const feeClaimers: Array<{ user: PublicKey; userBps: number }> = [
    { user: creatorWallet, userBps: creatorBps }
  ];
  
  for (const inf of influencers) {
    const { wallet } = await sdk.state.getLaunchWalletV2(inf.username, inf.provider);
    feeClaimers.push({ user: wallet, userBps: inf.bps });
  }
  
  // Create token with fee sharing
  const { tokenMint, tokenMetadata } = await sdk.tokenLaunch.createTokenInfoAndMetadata(tokenDetails);
  
  const configResult = await sdk.config.createBagsFeeShareConfig({
    payer: creatorWallet,
    baseMint: new PublicKey(tokenMint),
    feeClaimers
  });
  
  // Continue launch...
}

// Usage
await launchWithInfluencers(
  creatorWallet,
  [
    { username: "cryptoinfluencer", provider: "twitter", bps: 1500 },  // 15%
    { username: "kickstreamer", provider: "kick", bps: 1000 }          // 10%
  ],
  { name: "Cool Token", symbol: "COOL", ... }
);
// Creator gets 75%
```

---

## Pattern 5: Multi-Token Platform Analytics

**Goal:** Track performance across all tokens launched via your platform.

### Implementation

```typescript
interface TokenPerformance {
  mint: string;
  lifetimeFees: number;
  yourShare: number;  // Via partner key
}

async function getPlatformAnalytics(tokenMints: string[]): Promise<TokenPerformance[]> {
  const results: TokenPerformance[] = [];
  
  for (const mint of tokenMints) {
    const fees = await sdk.state.getTokenLifetimeFees(new PublicKey(mint));
    results.push({
      mint,
      lifetimeFees: fees / LAMPORTS_PER_SOL,
      yourShare: (fees * 0.25) / LAMPORTS_PER_SOL  // 25% partner share
    });
  }
  
  return results.sort((a, b) => b.lifetimeFees - a.lifetimeFees);
}

async function getPartnerDashboard(platformWallet: PublicKey) {
  const stats = await sdk.partner.getPartnerConfigClaimStats(platformWallet);
  
  return {
    totalClaimed: Number(stats.claimedFees) / LAMPORTS_PER_SOL,
    pendingClaim: Number(stats.unclaimedFees) / LAMPORTS_PER_SOL,
    totalEarned: (Number(stats.claimedFees) + Number(stats.unclaimedFees)) / LAMPORTS_PER_SOL
  };
}
```

---

## Anti-Patterns (What NOT to Do)

### ❌ Trying to implement holder dividends via fee sharing
Fee sharing is to specific wallets, not proportional to token holdings. Can't dynamically update claimers after launch.

### ❌ Creating 100 fee claimers for "decentralization"
Gas costs for claiming become prohibitive. Keep claimer count reasonable (<20).

### ❌ Assuming partner key works retroactively
Partner key only applies to tokens launched AFTER including it. Can't add to existing tokens.

### ❌ Frequent small buybacks
Transaction costs eat into buyback value. Batch buybacks weekly/monthly.

### ❌ Hardcoding influencer wallets
Use social username resolution — wallets may change, usernames are stable.

---

## Decision Matrix

| Goal | Pattern | Complexity |
|------|---------|------------|
| Earn from platform launches | Launchpad Platform | Low |
| Reduce supply over time | Treasury + Buyback | Medium |
| Team/investor share | Influencer Split | Low |
| Governance-based distribution | Revenue Share DAO | High |
| Track platform success | Multi-Token Analytics | Low |
