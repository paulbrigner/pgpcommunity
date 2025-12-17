import { describe, expect, it, vi } from "vitest";

import { acquireNonceLease, buildNonceLockKey, NonceLeaseBusyError } from "../sponsor/nonce-lock";
import { reserveDailySponsorTxSlot, SponsorRateLimitError } from "../sponsor/rate-limit";

describe("sponsor nonce lock", () => {
  it("builds the nonce lock key", () => {
    expect(buildNonceLockKey(8453, "0xabc")).toEqual({
      pk: "NONCE_LOCK#8453#0xabc",
      sk: "NONCE_LOCK#8453#0xabc",
    });
  });

  it("acquires a lease and returns nextNonce when present", async () => {
    const update = vi.fn().mockResolvedValue({ Attributes: { nextNonce: 41 } });
    const lease = await acquireNonceLease({
      chainId: 8453,
      sponsorAddress: "0xAbC",
      nowMs: 1000,
      leaseMs: 30_000,
      client: { update } as any,
      tableName: "TestTable",
    });

    expect(lease.key).toEqual({ pk: "NONCE_LOCK#8453#0xabc", sk: "NONCE_LOCK#8453#0xabc" });
    expect(lease.nextNonce).toBe(41);
    expect(typeof lease.leaseId).toBe("string");
    expect(lease.leaseUntil).toBe(31_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("throws NonceLeaseBusyError when the lock is held", async () => {
    const update = vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" });
    await expect(
      acquireNonceLease({
        chainId: 8453,
        sponsorAddress: "0xabc",
        client: { update } as any,
        tableName: "TestTable",
      }),
    ).rejects.toBeInstanceOf(NonceLeaseBusyError);
  });
});

describe("sponsor rate limit", () => {
  it("returns null when no limit is configured", async () => {
    const update = vi.fn();
    const result = await reserveDailySponsorTxSlot({
      chainId: 8453,
      sponsorAddress: "0xabc",
      maxTxPerDay: null,
      client: { update } as any,
      tableName: "TestTable",
    });
    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("increments and returns the used count", async () => {
    const update = vi.fn().mockResolvedValue({ Attributes: { txCount: 2 } });
    const result = await reserveDailySponsorTxSlot({
      chainId: 8453,
      sponsorAddress: "0xabc",
      maxTxPerDay: 10,
      nowMs: Date.UTC(2025, 0, 2, 0, 0, 0),
      client: { update } as any,
      tableName: "TestTable",
    });
    expect(result).toEqual({ day: "2025-01-02", used: 2, max: 10 });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("throws SponsorRateLimitError on conditional failure", async () => {
    const update = vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" });
    await expect(
      reserveDailySponsorTxSlot({
        chainId: 8453,
        sponsorAddress: "0xabc",
        maxTxPerDay: 1,
        client: { update } as any,
        tableName: "TestTable",
      }),
    ).rejects.toBeInstanceOf(SponsorRateLimitError);
  });
});

