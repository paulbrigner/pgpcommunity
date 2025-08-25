// This page interacts directly with the user's browser and wallet,
// so it needs to run on the client side rather than on the server.
"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth"; // Hooks for authentication and wallet interaction
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

const PAYWALL_CONFIG = {
  icon: "",
  locks: {
    [LOCK_ADDRESS]: {
      name: "PGP Community Membership",
      order: 1,
      network: BASE_NETWORK_ID,
      recipient: "",
      dataBuilder: "",
      emailRequired: true,
      maxRecipients: null,
    },
  },
  title: "Join the PGP* for Crypto Community",
  referrer: UNLOCK_ADDRESS,
  skipSelect: false,
  hideSoldOut: false,
  pessimistic: false,
  redirectUri: "https://www.pgpforcrypto.org/community",
  skipRecipient: true,
  endingCallToAction: "Join Now!",
  persistentCheckout: false,
};

export default function Home() {
  // Functions from Privy to log the user in/out and check auth state
  const {
    login,
    logout,
    authenticated,
    ready,
    getAccessToken,
    user,
    linkWallet,
    unlinkWallet,
  } = usePrivy();
  // List of wallets connected through Privy
  const { wallets } = useWallets();
  // Detailed membership state: 'active', 'expired', or 'none'
  const [membershipStatus, setMembershipStatus] = useState<
    "active" | "expired" | "none"
  >("none");
  // Indicates whether we are currently checking membership status
  const [loadingMembership, setLoadingMembership] = useState(false);
  // Flags to show when purchase/renewal or funding actions are running
  const [isPurchasing, setIsPurchasing] = useState(false);

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

    if (user?.wallet && user.wallet.address === wallets[0].address) {
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

  useEffect(() => {
    // Whenever authentication or wallet details change, re-check membership
    refreshMembership();
  }, [ready, authenticated, wallets]);

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

  const connect = () => {
    try {
      linkWallet();
    } catch (error) {
      console.error("Connection failed:", error);
    }
  };

  const disconnectWallet = async () => {
    const w = wallets[0];
    if (!w) return;
    try {
      await unlinkWallet(w.address);
      w.disconnect();
      setMembershipStatus("none");
    } catch (error) {
      console.error("Disconnect failed:", error);
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
      await paywall.loadCheckoutModal(PAYWALL_CONFIG);
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

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center">
        PGP for Crypto Community
      </h1>
      {/* The UI below shows different views based on authentication and membership state */}
      {!authenticated ? ( // User has not logged in yet
        <div className="space-y-4 text-center">
          <p>Please login to continue.</p>
          <button
            className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
            onClick={userLogin}
          >
            Login
          </button>
        </div>
      ) : wallets.length === 0 ? ( // Logged in but no external wallet (e.g. MetaMask) is detected
        <div className="space-y-4 text-center">
          <p>
            No external wallet detected. Please install and connect your wallet.
          </p>
          <div className="space-x-2">
            <button
              className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
              onClick={connect}
            >
              Connect Wallet
            </button>
            <button
              className="px-4 py-2 border rounded-md bg-gray-200 hover:bg-gray-300"
              onClick={logout}
            >
              Log Out
            </button>
          </div>
        </div>
      ) : loadingMembership ? ( // Waiting for membership check to finish
        <p>Checking membership…</p>
      ) : user ? ( // Only check wallet if user exists
        !user.wallet || user.wallet.address !== wallets[0].address ? ( // wallet connected but linked to another account
          <div className="space-y-4 text-center">
            <p>
              Your wallet is not connected or it is linked to another account.
              Please connect a wallet that is not already used in this system.
            </p>
            <button
              className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
              onClick={disconnectWallet}
            >
              Disconnect Wallet
            </button>
            <button
              className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
              onClick={connect}
            >
              Reconnect Wallet
            </button>
          </div>
        ) : membershipStatus === "active" ? ( // User has an active membership and can view content
          <div className="space-y-4 text-center">
            <p>
              Hello connected wallet, {wallets[0].address}! You’re a member.
            </p>
            <div className="space-x-2">
              <a
                className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  const url = await getContentUrl("index.html");
                  window.open(url, "_blank");
                }}
              >
                View Home
              </a>
              <a
                className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  const url = await getContentUrl("guide.html");
                  window.open(url, "_blank");
                }}
              >
                View Guide
              </a>
              <a
                className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  const url = await getContentUrl("faq.html");
                  window.open(url, "_blank");
                }}
              >
                View FAQ
              </a>
              <br />
              <br />
              <button
                className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
                onClick={logout}
              >
                Log Out
              </button>
            </div>
          </div>
        ) : (
          // Default membership not active case
          <div className="space-y-4 text-center">
            <p>
              Hello, {wallets[0].address}!{" "}
              {membershipStatus === "expired"
                ? "Your membership has expired."
                : "You need a membership."}
            </p>
            <div className="space-x-2">
              <button
                className="px-4 py-2 border rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                onClick={purchaseMembership}
                disabled={isPurchasing}
              >
                {isPurchasing
                  ? membershipStatus === "expired"
                    ? "Renewing…"
                    : "Purchasing…"
                  : membershipStatus === "expired"
                  ? "Renew Membership"
                  : "Get Membership"}
              </button>
              <button
                className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
                onClick={refreshMembership}
              >
                Refresh Status
              </button>
              <button
                className="px-4 py-2 border rounded-md bg-blue-600 text-white hover:bg-blue-700"
                onClick={logout}
              >
                Log Out
              </button>
            </div>
          </div>
        )
      ) : (
        // Handle loading/undefined user state
        <p>Loading user information...</p>
      )}
    </div>
  );
}
