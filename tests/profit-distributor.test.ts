// profit-distributor-contract.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MemberShare {
  share: number;
  lastClaimed: number;
}

interface Distribution {
  totalRevenue: number;
  totalContributions: number;
  timestamp: number;
  cooperativeId: number;
  status: string;
  feeCollected: number;
}

interface VestingSchedule {
  totalEntitled: number;
  periods: number;
  claimedPeriods: number;
  startBlock: number;
}

interface CooperativeConfig {
  minShareThreshold: number;
  maxMembers: number;
  autoDistribute: boolean;
  oraclePrincipal: string;
}

interface DistributionHistory {
  distributionId: number;
  amountClaimed: number;
  timestamp: number;
}

interface ContractState {
  contractOwner: string;
  isPaused: boolean;
  totalDistributed: number;
  distributionCounter: number;
  vestingEnabled: boolean;
  vestingPeriod: number;
  feePercentage: number;
  memberShares: Map<string, MemberShare>; // Key: `${co-op-id}-${member}`
  distributions: Map<number, Distribution>;
  vestingSchedules: Map<string, VestingSchedule>; // Key: `${dist-id}-${member}`
  cooperativeConfigs: Map<number, CooperativeConfig>;
  distributionHistory: Map<string, DistributionHistory>; // Key: `${member}-${index}`
  pendingProfits: Map<number, number>;
  blockHeight: number; // Mocked block height
}

// Mock external contracts
class MockContributionTracker {
  getTotalContributions(coOpId: number): ClarityResponse<number> {
    return { ok: true, value: 10000 }; // Mocked
  }

  getMemberContribution(coOpId: number, member: string): ClarityResponse<number> {
    return { ok: true, value: 1000 }; // Mocked
  }
}

class MockMembership {
  isValidMember(coOpId: number, member: string): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }

  getActiveMembers(coOpId: number): ClarityResponse<string[]> {
    return { ok: true, value: ["wallet_1", "wallet_2"] };
  }
}

class MockOracle {
  getRevenueData(coOpId: number): ClarityResponse<number> {
    return { ok: true, value: 5000 }; // Mocked
  }
}

// Mock contract implementation
class ProfitDistributorMock {
  private state: ContractState = {
    contractOwner: "deployer",
    isPaused: false,
    totalDistributed: 0,
    distributionCounter: 0,
    vestingEnabled: false,
    vestingPeriod: 100,
    feePercentage: 1,
    memberShares: new Map(),
    distributions: new Map(),
    vestingSchedules: new Map(),
    cooperativeConfigs: new Map(),
    distributionHistory: new Map(),
    pendingProfits: new Map(),
    blockHeight: 1000,
  };

  private contributionTracker = new MockContributionTracker();
  private membership = new MockMembership();
  private oracle = new MockOracle();

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_NO_CONTRIBUTIONS = 102;
  private ERR_DISTRIBUTION_ACTIVE = 103;
  private ERR_NO_PROFITS = 104;
  private ERR_INVALID_MEMBER = 105;
  private ERR_PAUSED = 106;
  private ERR_INVALID_PERIOD = 107;
  private ERR_ALREADY_CLAIMED = 108;
  private ERR_INSUFFICIENT_BALANCE = 109;
  private ERR_ORACLE_FAIL = 110;
  private ERR_INVALID_CONFIG = 111;
  private MAX_VESTING_PERIODS = 12;

  // Helper to get keys
  private getShareKey(coOpId: number, member: string): string {
    return `${coOpId}-${member}`;
  }

  private getVestingKey(distId: number, member: string): string {
    return `${distId}-${member}`;
  }

  private getHistoryKey(member: string, index: number): string {
    return `${member}-${index}`;
  }

  setOwner(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.isPaused = false;
    return { ok: true, value: true };
  }

  setFeePercentage(caller: string, newFee: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (newFee > 10) {
      return { ok: false, value: this.ERR_INVALID_CONFIG };
    }
    this.state.feePercentage = newFee;
    return { ok: true, value: true };
  }

  setVestingEnabled(caller: string, enabled: boolean, period: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (period <= 0) {
      return { ok: false, value: this.ERR_INVALID_PERIOD };
    }
    this.state.vestingEnabled = enabled;
    this.state.vestingPeriod = period;
    return { ok: true, value: true };
  }

  configureCooperative(
    caller: string,
    coOpId: number,
    minThreshold: number,
    maxMembers: number,
    auto: boolean,
    oracle: string
  ): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (maxMembers <= 0) {
      return { ok: false, value: this.ERR_INVALID_CONFIG };
    }
    this.state.cooperativeConfigs.set(coOpId, {
      minShareThreshold: minThreshold,
      maxMembers,
      autoDistribute: auto,
      oraclePrincipal: oracle,
    });
    return { ok: true, value: true };
  }

  depositProfits(caller: string, coOpId: number, amount: number): ClarityResponse<boolean> {
    if (this.state.isPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const current = this.state.pendingProfits.get(coOpId) ?? 0;
    this.state.pendingProfits.set(coOpId, current + amount);
    return { ok: true, value: true };
  }

  initiateDistribution(caller: string, coOpId: number): ClarityResponse<number> {
    const config = this.state.cooperativeConfigs.get(coOpId);
    if (!config) {
      return { ok: false, value: this.ERR_INVALID_CONFIG };
    }
    const revenue = this.oracle.getRevenueData(coOpId).value as number;
    const totalContribs = this.contributionTracker.getTotalContributions(coOpId).value as number;
    const pending = this.state.pendingProfits.get(coOpId) ?? 0;
    if (this.state.isPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (revenue + pending <= 0) {
      return { ok: false, value: this.ERR_NO_PROFITS };
    }
    const distId = this.state.distributionCounter + 1;
    const totalRevenue = revenue + pending;
    const fee = Math.floor((totalRevenue * this.state.feePercentage) / 100);
    const netRevenue = totalRevenue - fee;
    this.state.distributions.set(distId, {
      totalRevenue: netRevenue,
      totalContributions: totalContribs,
      timestamp: Date.now(),
      cooperativeId: coOpId,
      status: "active",
      feeCollected: fee,
    });
    this.state.distributionCounter = distId;
    this.state.pendingProfits.delete(coOpId);
    if (config.autoDistribute) {
      this.distributeProfits(caller, distId);
    }
    return { ok: true, value: distId };
  }

  distributeProfits(caller: string, distId: number): ClarityResponse<boolean> {
    const dist = this.state.distributions.get(distId);
    if (!dist) {
      return { ok: false, value: this.ERR_NO_PROFITS };
    }
    if (this.state.isPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (dist.status !== "active") {
      return { ok: false, value: this.ERR_DISTRIBUTION_ACTIVE };
    }
    const members = this.membership.getActiveMembers(dist.cooperativeId).value as string[];
    dist.status = "completed";
    this.state.distributions.set(distId, dist);
    let totalAllocated = 0;
    for (const member of members) {
      const contrib = this.contributionTracker.getMemberContribution(dist.cooperativeId, member).value as number;
      const share = Math.floor((contrib * dist.totalRevenue) / dist.totalContributions);
      const config = this.state.cooperativeConfigs.get(dist.cooperativeId)!;
      if (share >= config.minShareThreshold) {
        if (this.state.vestingEnabled) {
          this.state.vestingSchedules.set(this.getVestingKey(distId, member), {
            totalEntitled: share,
            periods: this.MAX_VESTING_PERIODS,
            claimedPeriods: 0,
            startBlock: this.state.blockHeight,
          });
        } else {
          this.state.memberShares.set(this.getShareKey(dist.cooperativeId, member), {
            share,
            lastClaimed: this.state.blockHeight,
          });
          // Simulate transfer
        }
        totalAllocated += share;
      }
    }
    this.state.totalDistributed += dist.totalRevenue;
    return { ok: true, value: true };
  }

  claimVestedShare(caller: string, distId: number): ClarityResponse<number> {
    const key = this.getVestingKey(distId, caller);
    const schedule = this.state.vestingSchedules.get(key);
    if (!schedule) {
      return { ok: false, value: this.ERR_ALREADY_CLAIMED };
    }
    if (this.state.isPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const periodsElapsed = Math.floor((this.state.blockHeight - schedule.startBlock) / this.state.vestingPeriod);
    const claimablePeriods = Math.min(periodsElapsed, schedule.periods) - schedule.claimedPeriods;
    const periodAmount = Math.floor(schedule.totalEntitled / schedule.periods);
    const claimAmount = claimablePeriods * periodAmount;
    if (claimAmount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    schedule.claimedPeriods += claimablePeriods;
    this.state.vestingSchedules.set(key, schedule);
    const dist = this.state.distributions.get(distId)!;
    this.state.memberShares.set(this.getShareKey(dist.cooperativeId, caller), {
      share: claimAmount,
      lastClaimed: this.state.blockHeight,
    });
    // Simulate transfer
    return { ok: true, value: claimAmount };
  }

  updateShare(caller: string, coOpId: number, member: string, newShare: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (newShare <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const key = this.getShareKey(coOpId, member);
    const current = this.state.memberShares.get(key);
    if (!current) {
      return { ok: false, value: this.ERR_INVALID_MEMBER };
    }
    this.state.memberShares.set(key, { ...current, share: newShare });
    return { ok: true, value: true };
  }

  getDistributionDetails(distId: number): ClarityResponse<Distribution | undefined> {
    return { ok: true, value: this.state.distributions.get(distId) };
  }

  getMemberShare(coOpId: number, member: string): ClarityResponse<MemberShare | undefined> {
    return { ok: true, value: this.state.memberShares.get(this.getShareKey(coOpId, member)) };
  }

  getVestingSchedule(distId: number, member: string): ClarityResponse<VestingSchedule | undefined> {
    return { ok: true, value: this.state.vestingSchedules.get(this.getVestingKey(distId, member)) };
  }

  getCooperativeConfig(coOpId: number): ClarityResponse<CooperativeConfig | undefined> {
    return { ok: true, value: this.state.cooperativeConfigs.get(coOpId) };
  }

  getPendingProfits(coOpId: number): ClarityResponse<number> {
    return { ok: true, value: this.state.pendingProfits.get(coOpId) ?? 0 };
  }

  getTotalDistributed(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalDistributed };
  }

  getDistributionHistory(member: string, index: number): ClarityResponse<DistributionHistory | undefined> {
    return { ok: true, value: this.state.distributionHistory.get(this.getHistoryKey(member, index)) };
  }

  isContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.isPaused };
  }

  getFeePercentage(): ClarityResponse<number> {
    return { ok: true, value: this.state.feePercentage };
  }

  getVestingInfo(): ClarityResponse<{ enabled: boolean; period: number }> {
    return { ok: true, value: { enabled: this.state.vestingEnabled, period: this.state.vestingPeriod } };
  }

  // For testing: advance block height
  advanceBlockHeight(blocks: number) {
    this.state.blockHeight += blocks;
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
};

describe("ProfitDistributorContract", () => {
  let contract: ProfitDistributorMock;

  beforeEach(() => {
    contract = new ProfitDistributorMock();
    vi.resetAllMocks();
  });

  it("should allow owner to pause and unpause", () => {
    const pause = contract.pause(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: true });

    const unpause = contract.unpause(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-owner from pausing", () => {
    const pause = contract.pause(accounts.user1);
    expect(pause).toEqual({ ok: false, value: 100 });
  });

  it("should configure cooperative", () => {
    const config = contract.configureCooperative(
      accounts.deployer,
      1,
      100,
      50,
      true,
      "oracle"
    );
    expect(config).toEqual({ ok: true, value: true });
    expect(contract.getCooperativeConfig(1)).toEqual({
      ok: true,
      value: {
        minShareThreshold: 100,
        maxMembers: 50,
        autoDistribute: true,
        oraclePrincipal: "oracle",
      },
    });
  });

  it("should deposit profits", () => {
    const deposit = contract.depositProfits(accounts.user1, 1, 1000);
    expect(deposit).toEqual({ ok: true, value: true });
    expect(contract.getPendingProfits(1)).toEqual({ ok: true, value: 1000 });
  });

  it("should initiate distribution with auto distribute", () => {
    contract.configureCooperative(
      accounts.deployer,
      1,
      100,
      50,
      true,
      "oracle"
    );
    contract.depositProfits(accounts.user1, 1, 1000);
    const init = contract.initiateDistribution(accounts.user1, 1);
    expect(init.ok).toBe(true);
    const distId = init.value as number;
    expect(contract.getDistributionDetails(distId)).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: "completed",
        totalRevenue: expect.any(Number),
      }),
    });
    expect(contract.getTotalDistributed()).toEqual({
      ok: true,
      value: expect.any(Number),
    });
  });

  it("should handle vesting claims", () => {
    contract.setVestingEnabled(accounts.deployer, true, 100);
    contract.configureCooperative(
      accounts.deployer,
      1,
      0,
      50,
      false,
      "oracle"
    );
    contract.initiateDistribution(accounts.user1, 1);
    const distId = 1;
    contract.distributeProfits(accounts.user1, distId);
    contract.advanceBlockHeight(300); // Advance to claim some periods
    const claim = contract.claimVestedShare(accounts.user1, distId);
    expect(claim.ok).toBe(true);
    expect(claim.value).toBeGreaterThan(0);
  });


  it("should get vesting info", () => {
    expect(contract.getVestingInfo()).toEqual({
      ok: true,
      value: { enabled: false, period: 100 },
    });
  });

  it("should prevent invalid fee percentage", () => {
    const setFee = contract.setFeePercentage(accounts.deployer, 11);
    expect(setFee).toEqual({ ok: false, value: 111 });
  });
});