# Bags API Skill for Claude Code

A Claude Code skill that enables Claude to build Solana applications using the [Bags API](https://bags.fm).

## What This Is

This is **not** documentation for humans. This is a knowledge package for Claude (the AI) to use when helping you build with the Bags API. Upload this skill to your Claude Code IDE, and Claude will know how to:

- Launch Solana tokens programmatically
- Configure fee sharing among multiple wallets
- Build launchpad platforms that earn partner fees
- Execute token swaps via API
- Claim accumulated trading fees

## Installation

### Claude Code (Desktop)

1. Download or clone this repository
2. In Claude Code, go to Settings → Skills
3. Click "Add Skill" and select the `bags-api` folder

### Claude.ai Projects

1. Download the skill folder
2. Upload the entire folder to your Claude Project

## Usage

Once installed, just ask Claude to help you build with Bags:

> "Help me launch a token with 50% of fees going to my treasury wallet"

> "Create a launchpad platform that earns 25% from every token launch"

> "Build a script to claim all my accumulated fees"

Claude will reference the skill automatically and generate correct, working code.

## Contents

```
bags-api/
├── SKILL.md                    # Main instructions for Claude
├── references/
│   ├── sdk-methods.md          # All SDK method signatures
│   ├── fee-sharing.md          # Fee share v2 constraints and patterns
│   ├── api-endpoints.md        # Raw API reference
│   └── patterns.md             # Strategic patterns (launchpad, buyback, etc.)
└── scripts/
    ├── launch-token.ts         # Basic token launch
    ├── launch-with-fee-share.ts # Launch with fee splitting
    ├── create-partner-key.ts   # Partner key creation
    ├── claim-fees.ts           # Fee claiming
    └── trade-tokens.ts         # Token trading
```

## Requirements

For the generated code to run, you'll need:

- Node.js 18+
- Bags API key from [dev.bags.fm](https://dev.bags.fm)
- Solana wallet with SOL for transactions

## Links

- [Bags API Documentation](https://docs.bags.fm)
- [Bags Developer Portal](https://dev.bags.fm)
- [Bags Platform](https://bags.fm)

## License

MIT
