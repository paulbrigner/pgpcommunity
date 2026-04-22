import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { useMembership } from "@/lib/hooks/use-membership";

vi.mock("@/app/actions/membership-state", () => ({
  fetchMembershipStateSnapshot: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

const useQueryMock = vi.mocked(useQuery);

describe("useMembership", () => {
  beforeEach(() => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: vi.fn(),
    } as any);
  });

  it("keeps empty membership state stable for authenticated users without linked wallets", async () => {
    const props = {
      ready: true,
      authenticated: true,
      walletAddress: null,
      wallets: [],
      addressesKey: "",
      initialMembershipSummary: null,
      initialMembershipStatus: "unknown" as const,
      initialMembershipExpiry: null,
      initialAllowancesLoaded: false,
    };

    const { result, rerender } = renderHook((hookProps) => useMembership(hookProps), {
      initialProps: props,
    });

    await waitFor(() => {
      expect(result.current.membershipStatus).toBe("none");
    });

    const firstAllowances = result.current.allowances;
    const firstTokenIds = result.current.tokenIds;

    expect(firstAllowances).toEqual({});
    expect(firstTokenIds).toEqual({});

    rerender({ ...props });

    await waitFor(() => {
      expect(result.current.membershipStatus).toBe("none");
      expect(result.current.allowances).toBe(firstAllowances);
      expect(result.current.tokenIds).toBe(firstTokenIds);
    });
  });
});
