import {
  BASE_NETWORK_ID,
  UNLOCK_SUBGRAPH_API_KEY,
  UNLOCK_SUBGRAPH_ID,
  UNLOCK_SUBGRAPH_URL,
} from "@/lib/config";

const GRAPH_GATEWAY_BASE = "https://gateway.thegraph.com/api/subgraphs/id";

export const RESOLVED_SUBGRAPH_URL =
  UNLOCK_SUBGRAPH_URL ||
  (UNLOCK_SUBGRAPH_ID
    ? `${GRAPH_GATEWAY_BASE}/${UNLOCK_SUBGRAPH_ID}`
    : BASE_NETWORK_ID
      ? `https://subgraph.unlock-protocol.com/${BASE_NETWORK_ID}`
      : null);

const SUBGRAPH_AUTH_HEADERS = UNLOCK_SUBGRAPH_API_KEY
  ? { Authorization: `Bearer ${UNLOCK_SUBGRAPH_API_KEY}` }
  : undefined;

export async function fetchSubgraph(body: string): Promise<Response> {
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
