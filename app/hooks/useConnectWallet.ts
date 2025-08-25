// app/hooks/useConnectWallet.ts
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

export const useConnectWallet = ({
  onSuccess,
  onError,
}: {
  onSuccess: (wallet: any) => void;
  onError: (error: any) => void;
}) => {
  const { connectWallet: privyConnect } = usePrivy();
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = async () => {
    setIsConnecting(true);
    try {
      await privyConnect();
    } catch (error: any) {
      onError(error);
    } finally {
      setIsConnecting(false);
    }
  };

  return { connect, isConnecting };
};
