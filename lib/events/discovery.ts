import { Contract } from "ethers";
import {
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_TIER_ADDRESSES,
  PRIMARY_LOCK_ADDRESS,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
} from "@/lib/config";
import { getRpcProvider } from "@/lib/rpc/provider";

type RelevantLock = {
  address: string;
  name?: string | null;
};

const LOCK_ABI = ["function owner() view returns (address)"] as const;
const provider = BASE_RPC_URL ? getRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID) : null;

const GRAPH_GATEWAY_BASE = "https://gateway.thegraph.com/api/subgraphs/id";
const RESOLVED_SUBGRAPH_URL =
  UNLOCK_SUBGRAPH_URL ||
  (UNLOCK_SUBGRAPH_ID ? `${GRAPH_GATEWAY_BASE}/${UNLOCK_SUBGRAPH_ID}` : BASE_NETWORK_ID ? `https://subgraph.unlock-protocol.com/${BASE_NETWORK_ID}` : null);
const SUBGRAPH_AUTH_HEADERS = UNLOCK_SUBGRAPH_API_KEY
  ? { Authorization: `Bearer ${UNLOCK_SUBGRAPH_API_KEY}` }
  : undefined;

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedLocks: RelevantLock[] | null = null;
let cachedAt = 0;
let cachedPrimaryDeployer: string | null = null;
let cachedPrimaryOwner: string | null = null;

async function fetchSubgraph(body: string) {
  if (!RESOLVED_SUBGRAPH_URL) {
    throw new Error("Unlock subgraph URL not configured");
  }
  return fetch(RESOLVED_SUBGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SUBGRAPH_AUTH_HEADERS ?? {}),
    },
    body,
    cache: "no-store",
  });
}

async function getPrimaryLockDeployer(): Promise<string | null> {
  if (cachedPrimaryDeployer) return cachedPrimaryDeployer;
  if (!RESOLVED_SUBGRAPH_URL || !PRIMARY_LOCK_ADDRESS) return null;
  try {
    const body = JSON.stringify({
      query: `query LockDeployer($address: String!) {
        locks(first: 1, where: { address: $address }) {
          deployer
        }
      }`,
      variables: { address: PRIMARY_LOCK_ADDRESS.toLowerCase() },
    });
    const res = await fetchSubgraph(body);
    if (!res.ok) return null;
    const json = await res.json();
    const deployer = json?.data?.locks?.[0]?.deployer;
    if (typeof deployer === "string" && deployer.length) {
      cachedPrimaryDeployer = deployer.toLowerCase();
    }
  } catch {
    cachedPrimaryDeployer = null;
  }
  return cachedPrimaryDeployer;
}

async function getPrimaryLockOwner(): Promise<string | null> {
  if (cachedPrimaryOwner) return cachedPrimaryOwner;
  if (!PRIMARY_LOCK_ADDRESS || !provider) return null;
  try {
    const lock = new Contract(PRIMARY_LOCK_ADDRESS, LOCK_ABI, provider);
    const owner: string = await lock.owner();
    cachedPrimaryOwner = owner ? owner.toLowerCase() : null;
  } catch {
    cachedPrimaryOwner = null;
  }
  return cachedPrimaryOwner;
}

async function fetchRelevantLocks(lockDeployer: string | null, lockOwner: string | null): Promise<RelevantLock[]> {
  if (!RESOLVED_SUBGRAPH_URL || (!lockDeployer && !lockOwner)) return [];
  const queryParts: string[] = [];
  const variableDecls: string[] = [];
  const variables: Record<string, string> = {};
  if (lockDeployer) {
    variableDecls.push("$deployer: String!");
    variables.deployer = lockDeployer;
    queryParts.push(`deployerLocks: locks(first: 200, where: { deployer: $deployer }) {
      address
      name
    }`);
  }
  if (lockOwner) {
    variableDecls.push("$owner: String!");
    variables.owner = lockOwner;
    queryParts.push(`managerLocks: locks(first: 200, where: { lockManagers_contains: [$owner] }) {
      address
      name
    }`);
  }
  if (!queryParts.length) return [];
  const query = `query RelevantLocks(${variableDecls.join(", ")}) {
    ${queryParts.join("\n")}
  }`;
  const body = JSON.stringify({ query, variables });
  const res = await fetchSubgraph(body);
  if (!res.ok) return [];
  const json = await res.json();
  const locks: RelevantLock[] = [];
  const pushLock = (entry: any) => {
    if (!entry) return;
    const address = typeof entry.address === "string" ? entry.address.toLowerCase() : null;
    if (!address) return;
    locks.push({ address, name: typeof entry.name === "string" ? entry.name : null });
  };
  (json?.data?.deployerLocks ?? []).forEach(pushLock);
  (json?.data?.managerLocks ?? []).forEach(pushLock);
  return locks;
}

export async function fetchRelevantEventLocks(): Promise<RelevantLock[]> {
  const now = Date.now();
  if (cachedLocks && now - cachedAt < CACHE_TTL_MS) return cachedLocks;
  cachedAt = now;

  const [deployer, owner] = await Promise.all([getPrimaryLockDeployer(), getPrimaryLockOwner()]);
  const locks = await fetchRelevantLocks(deployer, owner);
  const seen = new Set<string>();
  const filtered: RelevantLock[] = [];
  for (const lock of locks) {
    const address = lock.address.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    if (MEMBERSHIP_TIER_ADDRESSES.has(address)) continue;
    filtered.push(lock);
  }
  cachedLocks = filtered;
  return filtered;
}

export async function isAllowedEventLock(lockAddressLower: string): Promise<boolean> {
  const locks = await fetchRelevantEventLocks();
  return locks.some((lock) => lock.address === lockAddressLower);
}
