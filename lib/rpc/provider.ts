import { JsonRpcProvider } from "ethers";
import { BASE_NETWORK_ID, BASE_RPC_URL } from "@/lib/config";

const providers = new Map<string, JsonRpcProvider>();

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;

function shouldRetry(error: any): boolean {
  const code = error?.code ?? error?.statusCode ?? error?.error?.code;
  if (code === 429 || code === 503) return true;
  const status = error?.response?.status;
  if (status === 429 || status === 503) return true;
  return false;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachRetry(provider: JsonRpcProvider): JsonRpcProvider {
  const send = provider.send.bind(provider);
  provider.send = (async (method: string, params: Array<any>) => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await send(method, params);
      } catch (err: any) {
        if (attempt >= MAX_RETRIES || !shouldRetry(err)) {
          throw err;
        }
        const backoff = BASE_DELAY_MS * 2 ** attempt;
        const jitter = backoff * (0.2 * Math.random());
        await delay(backoff + jitter);
        attempt += 1;
      }
    }
  }) as typeof provider.send;
  return provider;
}

export function getRpcProvider(rpcUrl: string = BASE_RPC_URL, networkId: number = BASE_NETWORK_ID): JsonRpcProvider {
  const key = `${networkId}:${rpcUrl}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = attachRetry(new JsonRpcProvider(rpcUrl, networkId));
    providers.set(key, provider);
  }
  return provider;
}
