# 🌾 CoopFarm: Blockchain-Powered Cooperative Farming Platform

Welcome to CoopFarm, a decentralized platform built on the Stacks blockchain using Clarity smart contracts! This project addresses real-world challenges in cooperative farming, such as opaque contribution tracking, unfair profit distribution, and lack of transparency in investments. By leveraging blockchain, CoopFarm enables farmers and investors to pool resources, record contributions immutably, and distribute profits fairly based on verified records. No more disputes over who contributed what—everything is on-chain and auditable.

## ✨ Features

🌱 **Secure Membership**: Farmers and investors join cooperatives with verified identities and roles.
💰 **Investment Pooling**: Crowdfund farming projects with transparent escrow and milestone-based releases.
📊 **Immutable Contributions**: Track labor, capital, and resources contributed by each member.
📈 **Profit Distribution**: Automatically calculate and distribute profits based on contribution shares.
🗳️ **Governance Voting**: Members vote on key decisions like project approvals or fund allocations.
🔒 **Dispute Resolution**: On-chain arbitration for conflicts, with evidence tied to immutable records.
📡 **Oracle Integration**: Fetch real-world data (e.g., crop yields or market prices) for accurate profit calculations.
🔄 **Tokenized Shares**: Issue and trade cooperative shares as fungible tokens for liquidity.

## 🛠 How It Works

CoopFarm uses 8 interconnected Clarity smart contracts to create a robust ecosystem for cooperative farming. Here's a high-level overview:

### Key Smart Contracts
1. **MembershipContract.clar**: Handles user registration, role assignment (e.g., farmer, investor), and KYC-like verification via STX wallet addresses. Ensures only approved members can participate.
2. **InvestmentPoolContract.clar**: Manages crowdfunding for farming projects. Users deposit STX or tokens into escrow, with funds released upon reaching milestones (e.g., planting season start).
3. **ContributionTrackerContract.clar**: Records immutable contributions like hours worked, equipment provided, or funds invested. Uses timestamps and hashes for proof, preventing tampering.
4. **ProfitDistributorContract.clar**: Calculates profit shares based on contribution weights. Distributes earnings (e.g., from crop sales) proportionally via automated payouts.
5. **GovernanceContract.clar**: Enables voting on proposals, such as new investments or rule changes. Uses weighted votes based on contribution shares.
6. **DisputeResolverContract.clar**: Allows members to file disputes with on-chain evidence. Resolves via majority vote or predefined rules, enforcing outcomes like fund reallocations.
7. **OracleFeedContract.clar**: Integrates external data feeds (e.g., via Stacks oracles) for real-time inputs like harvest yields or commodity prices, triggering profit calculations.
8. **ShareTokenContract.clar**: A SIP-010 compliant fungible token contract for issuing cooperative shares. Tokens represent ownership and can be transferred or staked for additional perks.

**For Farmers/Investors**
- Register via `MembershipContract` and join a cooperative.
- Contribute resources through `ContributionTrackerContract` (e.g., call `record-contribution` with details like amount and proof hash).
- Invest in projects using `InvestmentPoolContract` by sending STX to the pool.
- Participate in votes via `GovernanceContract` to approve farm initiatives.

**For Profit Distribution**
- Once profits are realized (e.g., from sales), input data via `OracleFeedContract`.
- Call `distribute-profits` in `ProfitDistributorContract` to automatically payout based on tracked contributions.
- Use `DisputeResolverContract` if any issues arise—resolutions are enforced on-chain.

**Verification and Transparency**
- Anyone can query contracts like `get-contribution-details` or `verify-share-ownership` for instant audits.
- All transactions are immutable on the Stacks blockchain, secured by Bitcoin.

This setup solves key problems like trust deficits in rural cooperatives, enabling scalable, fair farming investments worldwide. Get started by deploying these Clarity contracts on Stacks testnet! 🚀