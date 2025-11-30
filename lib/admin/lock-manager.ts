import { Contract, JsonRpcProvider } from "ethers";
import { BASE_NETWORK_ID, BASE_RPC_URL } from "@/lib/config";

const LOCK_MANAGER_ABI = ["function isLockManager(address) view returns (bool)"] as const;

export async function isLockManager(lockAddress: string, manager: string, rpcUrl = BASE_RPC_URL, chainId = BASE_NETWORK_ID) {
  if (!lockAddress || !manager) return false;
  try {
    const provider = new JsonRpcProvider(rpcUrl, chainId);
    const lock = new Contract(lockAddress, LOCK_MANAGER_ABI, provider);
    return await lock.isLockManager(manager);
  } catch (err) {
    console.warn("isLockManager check failed", lockAddress, manager, err);
    return false;
  }
}
