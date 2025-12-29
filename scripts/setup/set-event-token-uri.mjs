import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";

const usage = () => {
  console.log("Usage:");
  console.log("  EVENT_SPONSOR_PRIVATE_KEY=... BASE_RPC_URL=... EVENT_METADATA_BASE_URL=https://pgpforcrypto.org \\");
  console.log("    node scripts/setup/set-event-token-uri.mjs --lock 0xLOCK");
  console.log("");
  console.log("Options:");
  console.log("  --lock       Lock address to update (or EVENT_LOCK_ADDRESS env)");
  console.log("  --base-url   Base site URL (or EVENT_METADATA_BASE_URL env)");
};

const args = process.argv.slice(2);
const getArg = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
};

const lockAddressRaw = getArg("--lock") || process.env.EVENT_LOCK_ADDRESS || process.env.LOCK_ADDRESS || "";
const baseUrlRaw = getArg("--base-url") || process.env.EVENT_METADATA_BASE_URL || "";
const rpcUrl =
  process.env.EVENT_SPONSOR_RPC_URL ||
  process.env.BASE_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  "";
const privateKey = process.env.EVENT_SPONSOR_PRIVATE_KEY || "";

if (!lockAddressRaw || !baseUrlRaw || !rpcUrl || !privateKey) {
  console.error("Missing required config.");
  usage();
  process.exit(1);
}

let lockAddress;
try {
  lockAddress = getAddress(lockAddressRaw);
} catch {
  console.error("Invalid lock address:", lockAddressRaw);
  process.exit(1);
}

const baseUrl = baseUrlRaw.replace(/\/+$/, "");
if (!baseUrl.startsWith("http")) {
  console.error("Base URL must include http/https:", baseUrlRaw);
  process.exit(1);
}

const tokenBaseUri = `${baseUrl}/api/events/metadata/${lockAddress}/`;

const provider = new JsonRpcProvider(rpcUrl);
const signer = new Wallet(privateKey, provider);
const lock = new Contract(
  lockAddress,
  [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function setLockMetadata(string name, string symbol, string baseTokenURI)",
  ],
  signer,
);

try {
  const [name, symbol] = await Promise.all([lock.name(), lock.symbol()]);
  if (!name || !symbol) {
    console.error("Lock name/symbol missing; aborting to avoid overwriting metadata.");
    process.exit(1);
  }
  console.log("Setting baseTokenURI:", tokenBaseUri);
  console.log("Lock:", lockAddress);
  const tx = await lock.setLockMetadata(name, symbol, tokenBaseUri);
  console.log("Transaction submitted:", tx.hash);
  const receipt = await tx.wait();
  console.log("Transaction confirmed:", receipt?.transactionHash || tx.hash);
} catch (err) {
  console.error("Failed to update lock metadata:", err?.message || err);
  process.exit(1);
}
