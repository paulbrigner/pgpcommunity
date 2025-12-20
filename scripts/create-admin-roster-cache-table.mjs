#!/usr/bin/env node
/**
 * Create the admin roster cache DynamoDB table.
 *
 * Usage:
 *   REGION_AWS=us-east-1 ADMIN_ROSTER_CACHE_TABLE=AdminRosterCache node scripts/create-admin-roster-cache-table.mjs
 *   node scripts/create-admin-roster-cache-table.mjs --region us-east-1 --table AdminRosterCache
 *   node scripts/create-admin-roster-cache-table.mjs --skip-ttl
 */
import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const args = process.argv.slice(2);
const usage = () => {
  console.log(
    [
      "Usage:",
      "  node scripts/create-admin-roster-cache-table.mjs [--region us-east-1] [--table AdminRosterCache] [--skip-ttl]",
      "",
      "Env fallbacks:",
      "  REGION_AWS or AWS_REGION, ADMIN_ROSTER_CACHE_TABLE",
    ].join("\n"),
  );
};

let region = process.env.REGION_AWS || process.env.AWS_REGION || "";
let tableName = process.env.ADMIN_ROSTER_CACHE_TABLE || "";
let skipTtl = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--region" && args[i + 1]) {
    region = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--table" && args[i + 1]) {
    tableName = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--skip-ttl" || arg === "--no-ttl") {
    skipTtl = true;
    continue;
  }
}

if (!region) {
  console.error("Missing region. Set REGION_AWS or AWS_REGION, or pass --region.");
  usage();
  process.exit(1);
}

if (!tableName) {
  console.error("Missing table name. Set ADMIN_ROSTER_CACHE_TABLE or pass --table.");
  usage();
  process.exit(1);
}

const client = new DynamoDBClient({ region });

async function ensureTtlEnabled() {
  if (skipTtl) return;
  try {
    const res = await client.send(new DescribeTimeToLiveCommand({ TableName: tableName }));
    const status = res.TimeToLiveDescription?.TimeToLiveStatus;
    if (status === "ENABLED" || status === "ENABLING") {
      console.log(`TTL already ${status?.toLowerCase()} on ${tableName}.`);
      return;
    }
  } catch (err) {
    console.warn("Unable to read TTL status, continuing to set TTL.", err?.message || err);
  }
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: {
        AttributeName: "expiresAtEpochSec",
        Enabled: true,
      },
    }),
  );
  console.log(`TTL enabled on ${tableName} for attribute expiresAtEpochSec.`);
}

async function main() {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table already exists: ${tableName}`);
    await ensureTtlEnabled();
    return;
  } catch (err) {
    const name = err?.name || err?.code;
    if (name !== "ResourceNotFoundException") {
      console.error("Failed to describe table.", err);
      process.exit(1);
    }
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
    }),
  );
  console.log(`CreateTable issued for ${tableName}. Waiting for ACTIVE...`);
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
  console.log(`Table is ACTIVE: ${tableName}`);
  await ensureTtlEnabled();
}

main().catch((err) => {
  console.error("Failed to create admin roster cache table.", err);
  process.exit(1);
});
