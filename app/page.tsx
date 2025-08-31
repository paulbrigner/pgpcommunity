// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import {
  useLogin,
  usePrivy,
  useWallets,
  useConnectWallet,
} from "@privy-io/react-auth"; // Hooks for authentication and wallet interaction
import { useState, useEffect, useMemo } from "react"; // React helpers for state and lifecycle
import { Paywall } from "@unlock-protocol/paywall";
import { networks } from "@unlock-protocol/networks";
import {
  LOCK_ADDRESS,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  UNLOCK_ADDRESS,
} from "@/lib/config"; // Environment-specific constants
import { checkMembership as fetchMembership } from "@/lib/membership"; // Helper function for membership logic
import { Button } from "@/components/ui/button";

const PAYWALL_CONFIG = {
  icon: "",
  locks: {
    [LOCK_ADDRESS]: {
      name: "PGP Community Membership",
      order: 1,
      network: BASE_NETWORK_ID,
      recipient: "",
      dataBuilder: "",
      emailRequired: false,
      maxRecipients: null,
    },
  },
  title: "Join the PGP* for Crypto Community",
  referrer: UNLOCK_ADDRESS,
  skipSelect: false,
  hideSoldOut: false,
  pessimistic: false,
  skipRecipient: true,
  endingCallToAction: "Join Now!",
  persistentCheckout: false,
};

export default function Home() {
  // Functions from Privy to log the user in/out and check auth state
  const {
    logout,
    authenticated,
    ready,
    getAccessToken,
    user,
    linkWallet,
    unlinkWallet,
  } = usePrivy();

  const { login } = useLogin({
    onComplete: ({
      user,
      isNewUser,
      wasAlreadyAuthenticated,
      loginMethod,
      loginAccount,
    }) => {
      // console.log("User logged in successfully", user);
      // console.log("Is new user:", isNewUser);
      // console.log("Was already authenticated:", wasAlreadyAuthenticated);
      // console.log("Login method:", loginMethod);
      // console.log("Login account:", loginAccount);
      // Navigate to dashboard, show welcome message, etc.
    },
    onError: (error) => {
      console.error("Login failed", error);
      // Show error message
    },
  });

  // List of wallets connected through Privy
  const { wallets } = useWallets();
  const connectedWallet = wallets[0];
  const connectedAddress = connectedWallet?.address?.toLowerCase();
  const linkedAddress = user?.wallet?.address?.toLowerCase();
  const hasLinkedWallet = Boolean(user?.wallet?.address);
  const hasConnectedWallet = wallets.length > 0;
  const sameWalletLinkedAndConnected =
    hasLinkedWallet && hasConnectedWallet && connectedAddress === linkedAddress;
  // Detailed membership state: 'active', 'expired', or 'none'
  const [membershipStatus, setMembershipStatus] = useState<
    "active" | "expired" | "none"
  >("none");
  // Indicates whether we are currently checking membership status
  const [loadingMembership, setLoadingMembership] = useState(false);
  // Flags to show when purchase/renewal or funding actions are running
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Paywall instance configured for the Base network
  const paywall = useMemo(() => {
    return new Paywall({
      ...networks,
      [BASE_NETWORK_ID]: {
        ...networks[BASE_NETWORK_ID],
        provider: BASE_RPC_URL,
      },
    });
  }, [BASE_NETWORK_ID, BASE_RPC_URL]);

  // Check on-chain whether the connected wallet has a valid membership
  const refreshMembership = async () => {
    if (!ready || !authenticated || wallets.length === 0) {
      setMembershipStatus("none");
      return;
    }

    if (sameWalletLinkedAndConnected) {
      setLoadingMembership(true);
      try {
        const status = await fetchMembership(
          wallets,
          BASE_RPC_URL,
          BASE_NETWORK_ID,
          LOCK_ADDRESS
        );
        setMembershipStatus(status);
      } catch (error) {
        console.error("Membership check failed:", error);
      } finally {
        setLoadingMembership(false);
      }
    } else {
      setMembershipStatus("none");
    }
  };

  const { connectWallet } = useConnectWallet();

  useEffect(() => {
    // When auth + linked == connected, check membership automatically
    if (ready && authenticated && sameWalletLinkedAndConnected) {
      refreshMembership();
    }
  }, [ready, authenticated, sameWalletLinkedAndConnected]);

  // Trigger the Privy login flow if the user is not authenticated
  const userLogin = async () => {
    if (!authenticated) {
      try {
        login();
      } catch (error) {
        console.error("Login error:", error);
      }
    }
  };

  // Trigger the Privy wallet connect flow
  // If a linked wallet exists, suggest connecting that address.
  // Otherwise, fall back to linking a wallet to the user.
  const connect = async () => {
    try {
      const addr = user?.wallet?.address;
      if (addr) {
        // Suggest connecting a wallet; Privy's connectWallet does not accept an address option in this version.
        await connectWallet();
      } else {
        await linkWallet();
      }
    } catch (error) {
      console.error("Connection failed:", error);
    }
  };

  // Unlink the current external EVM wallet (ignore embedded/Privy wallets)
  const unlinkCurrentWallet = async () => {
    try {
      const w: any = user?.wallet;
      if (!w) return;
      await unlinkWallet(w.address);
    } catch (error) {
      console.error("Unlink failed:", error);
    } finally {
      setMembershipStatus("none");
    }
  };

  // Open the Unlock Protocol checkout using the existing provider
  const purchaseMembership = async () => {
    const w = wallets[0];
    if (!w?.address) {
      console.error("No wallet connected.");
      return;
    }
    setIsPurchasing(true);
    try {
      const provider = await w.getEthereumProvider();
      await paywall.connect(provider);
      // Prevent Unlock from navigating; we'll control refresh ourselves.
      const checkoutConfig = { ...PAYWALL_CONFIG } as any;
      delete checkoutConfig.redirectUri;
      await paywall.loadCheckoutModal(checkoutConfig);
      // Force a single hard reload after the modal fully closes.
      if (typeof window !== "undefined") {
        window.location.replace(window.location.href);
        return;
      }
      await refreshMembership();
    } catch (error) {
      console.error("Purchase failed:", error);
    } finally {
      setIsPurchasing(false);
    }
  };

  // Ask the backend for a short-lived signed URL to view gated content
  const getContentUrl = async (file: string): Promise<string> => {
    const w = wallets[0];
    if (!w?.address) {
      throw new Error("No wallet connected.");
    }
    try {
      const accessToken = await getAccessToken();
      const res = await fetch(`/api/content/${file}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch signed URL");
      }
      const data = await res.json();
      return data.url;
    } catch (err) {
      console.error("Could not load content:", err);
      throw err;
    }
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshMembership();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center">
        PGP for Crypto Community
      </h1>
      {/* Scenario-driven UI based on auth, wallet linking, and membership */}
      {!ready ? (
        <p>Loading…</p>
      ) : !authenticated ? (
        // Not logged in yet
        <div className="space-y-4 text-center">
          <p>Please login to continue.</p>
          <Button onClick={userLogin}>Login</Button>
        </div>
      ) : !hasConnectedWallet ? (
        // Logged in but no external wallet detected/connected
        <div className="space-y-4 text-center">
          <p>
            No external wallet detected. Please install and connect your wallet.
          </p>
          <div className="space-x-2">
            <Button onClick={connect}>Connect Wallet</Button>
            <Button variant="outline" onClick={logout}>
              Log Out
            </Button>
          </div>
        </div>
      ) : !hasLinkedWallet ? (
        // Has a connected wallet but user has no linked wallet yet
        <div className="space-y-4 text-center">
          <p>A wallet is connected. Link it to continue.</p>
          <div className="space-x-2">
            <Button onClick={connect}>Link Wallet</Button>
            <Button variant="outline" onClick={logout}>
              Log Out
            </Button>
          </div>
        </div>
      ) : !sameWalletLinkedAndConnected ? (
        // A wallet is connected but it does not match the linked wallet
        <div className="space-y-4 text-center">
          <p>
            Connected wallet ({connectedWallet?.address}) does not match your
            linked wallet ({user?.wallet?.address}).
          </p>
          <p>Switch to the linked wallet in your wallet app, then refresh.</p>
          <div className="space-x-2">
            <Button onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button onClick={unlinkCurrentWallet} variant="secondary">
              Unlink Wallet
            </Button>
            <Button onClick={connect}>Link Current Wallet</Button>
            <Button variant="outline" onClick={logout}>
              Log Out
            </Button>
          </div>
        </div>
      ) : loadingMembership ? (
        <p>Checking membership…</p>
      ) : membershipStatus === "active" ? (
        // Scenario 1: linked wallet has a valid membership -> authorized
        <div className="space-y-4 text-center">
          <p>
            Hello {user?.email?.address ?? user?.wallet?.address ?? "member"}!
            You’re a member.
          </p>
          <div className="space-x-2">
            <Button
              asChild
              onClick={async (e) => {
                e.preventDefault();
                const url = await getContentUrl("index.html");
                window.open(url, "_blank");
              }}
            >
              <a href="#">View Home</a>
            </Button>
            <Button
              asChild
              onClick={async (e) => {
                e.preventDefault();
                const url = await getContentUrl("guide.html");
                window.open(url, "_blank");
              }}
            >
              <a href="#">View Guide</a>
            </Button>
            <Button
              asChild
              onClick={async (e) => {
                e.preventDefault();
                const url = await getContentUrl("faq.html");
                window.open(url, "_blank");
              }}
            >
              <a href="#">View FAQ</a>
            </Button>
            <br />
            <br />
            <Button variant="outline" onClick={logout}>
              Log Out
            </Button>
          </div>
        </div>
      ) : (
        // Scenario 2: linked wallet but no valid membership -> offer purchase/renew or unlink
        <div className="space-y-4 text-center">
          <p>
            Hello, {connectedWallet?.address}!{" "}
            {membershipStatus === "expired"
              ? "Your membership has expired."
              : "You need a membership."}
          </p>
          <div className="space-x-2">
            <Button onClick={purchaseMembership} disabled={isPurchasing}>
              {isPurchasing
                ? membershipStatus === "expired"
                  ? "Renewing…"
                  : "Purchasing…"
                : membershipStatus === "expired"
                ? "Renew Membership"
                : "Get Membership"}
            </Button>
            <Button onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh Status"}
            </Button>
            <Button onClick={unlinkCurrentWallet} variant="secondary">
              Unlink Wallet
            </Button>
            <Button variant="outline" onClick={logout}>
              Log Out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
