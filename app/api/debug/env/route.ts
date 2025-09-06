import { NextResponse } from "next/server";
import {
  NEXTAUTH_SECRET,
  NEXTAUTH_URL,
  NEXTAUTH_TABLE,
  EMAIL_SERVER,
  EMAIL_FROM,
  EMAIL_SERVER_HOST,
  EMAIL_SERVER_PORT,
  EMAIL_SERVER_USER,
  EMAIL_SERVER_PASSWORD,
  EMAIL_SERVER_SECURE,
} from "@/lib/config.server";
import {
  UNLOCK_ADDRESS,
  LOCK_ADDRESS,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  USDC_ADDRESS,
  PRIVATE_KEY_SECRET_ARN,
  CLOUDFRONT_DOMAIN,
  KEY_PAIR_ID,
  AWS_REGION,
} from "@/lib/config.public";

export const runtime = "nodejs";
export const revalidate = 0;

function has(v: unknown): boolean {
  return typeof v === "string" ? v.length > 0 : v !== undefined && v !== null;
}

function readAmplifyEnv(scope: "server" | "client" | "base"): Record<string, string | undefined> {
  try {
    // eslint-disable-next-line no-eval
    const req: any = (eval as any)("require");
    const mod = scope === "server"
      ? (() => { try { return req("$amplify/env/server"); } catch { return undefined; } })()
      : scope === "client"
      ? (() => { try { return req("$amplify/env/client"); } catch { return undefined; } })()
      : (() => { try { return req("$amplify/env"); } catch { return undefined; } })();
    if (!mod) return {};
    if (mod.env && typeof mod.env === "object") return mod.env as Record<string, string | undefined>;
    if (mod.default?.env && typeof mod.default.env === "object") return mod.default.env as Record<string, string | undefined>;
    if (typeof mod === "object") return mod as Record<string, string | undefined>;
  } catch {}
  return {};
}

export async function GET() {
  const serverKeys = [
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "NEXTAUTH_TABLE",
    "EMAIL_SERVER",
    "EMAIL_FROM",
    "EMAIL_SERVER_HOST",
    "EMAIL_SERVER_PORT",
    "EMAIL_SERVER_USER",
    "EMAIL_SERVER_PASSWORD",
    "EMAIL_SERVER_SECURE",
  ];
  const clientKeys = [
    "NEXT_PUBLIC_LOCK_ADDRESS",
    "NEXT_PUBLIC_UNLOCK_ADDRESS",
    "NEXT_PUBLIC_BASE_NETWORK_ID",
    "NEXT_PUBLIC_BASE_RPC_URL",
    "NEXT_PUBLIC_CLOUDFRONT_DOMAIN",
    "NEXT_PUBLIC_KEY_PAIR_ID",
    "NEXT_PUBLIC_AWS_REGION",
    "NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN",
  ];

  const ampServer = readAmplifyEnv("server");
  const ampClient = readAmplifyEnv("client");
  const ampBase = readAmplifyEnv("base");

  const presence = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    resolved: {
      server: {
        NEXTAUTH_SECRET: has(NEXTAUTH_SECRET),
        NEXTAUTH_URL: has(NEXTAUTH_URL),
        NEXTAUTH_TABLE: has(NEXTAUTH_TABLE),
        EMAIL_SERVER: has(EMAIL_SERVER),
        EMAIL_FROM: has(EMAIL_FROM),
        EMAIL_SERVER_HOST: has(EMAIL_SERVER_HOST),
        EMAIL_SERVER_PORT: has(EMAIL_SERVER_PORT),
        EMAIL_SERVER_USER: has(EMAIL_SERVER_USER),
        EMAIL_SERVER_PASSWORD: has(EMAIL_SERVER_PASSWORD),
        EMAIL_SERVER_SECURE: has(EMAIL_SERVER_SECURE),
      },
      client: {
        NEXT_PUBLIC_LOCK_ADDRESS: has(LOCK_ADDRESS),
        NEXT_PUBLIC_UNLOCK_ADDRESS: has(UNLOCK_ADDRESS),
        NEXT_PUBLIC_BASE_NETWORK_ID: has(BASE_NETWORK_ID),
        NEXT_PUBLIC_BASE_RPC_URL: has(BASE_RPC_URL),
        NEXT_PUBLIC_USDC_ADDRESS: has(USDC_ADDRESS),
        NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN: has(PRIVATE_KEY_SECRET_ARN),
        NEXT_PUBLIC_CLOUDFRONT_DOMAIN: has(CLOUDFRONT_DOMAIN),
        NEXT_PUBLIC_KEY_PAIR_ID: has(KEY_PAIR_ID),
        NEXT_PUBLIC_AWS_REGION: has(AWS_REGION),
      },
    },
    raw: {
      processEnv: {
        // server
        NEXTAUTH_SECRET: has(process.env.NEXTAUTH_SECRET),
        NEXTAUTH_URL: has(process.env.NEXTAUTH_URL),
        NEXTAUTH_TABLE: has(process.env.NEXTAUTH_TABLE),
        EMAIL_SERVER: has(process.env.EMAIL_SERVER),
        EMAIL_FROM: has(process.env.EMAIL_FROM),
        EMAIL_SERVER_HOST: has(process.env.EMAIL_SERVER_HOST),
        EMAIL_SERVER_PORT: has(process.env.EMAIL_SERVER_PORT),
        EMAIL_SERVER_USER: has(process.env.EMAIL_SERVER_USER),
        EMAIL_SERVER_PASSWORD: has(process.env.EMAIL_SERVER_PASSWORD),
        EMAIL_SERVER_SECURE: has(process.env.EMAIL_SERVER_SECURE),
        // client
        NEXT_PUBLIC_LOCK_ADDRESS: has(process.env.NEXT_PUBLIC_LOCK_ADDRESS),
        NEXT_PUBLIC_UNLOCK_ADDRESS: has(process.env.NEXT_PUBLIC_UNLOCK_ADDRESS),
        NEXT_PUBLIC_BASE_NETWORK_ID: has(process.env.NEXT_PUBLIC_BASE_NETWORK_ID),
        NEXT_PUBLIC_BASE_RPC_URL: has(process.env.NEXT_PUBLIC_BASE_RPC_URL),
        NEXT_PUBLIC_CLOUDFRONT_DOMAIN: has(process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN),
        NEXT_PUBLIC_KEY_PAIR_ID: has(process.env.NEXT_PUBLIC_KEY_PAIR_ID),
        NEXT_PUBLIC_AWS_REGION: has(process.env.NEXT_PUBLIC_AWS_REGION),
        NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN: has(process.env.NEXT_PUBLIC_PRIVATE_KEY_SECRET_ARN),
      },
      amplifyServer: Object.fromEntries(serverKeys.map((k) => [k, has(ampServer[k])])),
      amplifyClient: Object.fromEntries(clientKeys.map((k) => [k, has(ampClient[k])])),
      amplifyBase: Object.fromEntries([...serverKeys, ...clientKeys].map((k) => [k, has(ampBase[k])])),
    },
  };

  return NextResponse.json(presence);
}

