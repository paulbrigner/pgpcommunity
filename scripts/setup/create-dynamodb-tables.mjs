#!/usr/bin/env node
/**
 * Create DynamoDB tables for a fresh install (NextAuth + admin roster cache).
 *
 * Usage:
 *   REGION_AWS=us-east-1 NEXTAUTH_TABLE=NextAuth ADMIN_ROSTER_CACHE_TABLE=AdminRosterCache EVENT_METADATA_TABLE=EventMetadata \
 *     node scripts/setup/create-dynamodb-tables.mjs
 *
 *   node scripts/setup/create-dynamodb-tables.mjs \
 *     --region us-east-1 \
 *     --nextauth-table NextAuth \
 *     --cache-table AdminRosterCache \
 *     --event-table EventMetadata
 *
 *   node scripts/setup/create-dynamodb-tables.mjs --skip-cache
 *   node scripts/setup/create-dynamodb-tables.mjs --skip-ttl
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
      "  node scripts/setup/create-dynamodb-tables.mjs [options]",
      "",
      "Options:",
      "  --region <region>              AWS region (or REGION_AWS/AWS_REGION env)",
      "  --nextauth-table <name>        NextAuth table name (or NEXTAUTH_TABLE env)",
      "  --cache-table <name>           Admin roster cache table name (or ADMIN_ROSTER_CACHE_TABLE env)",
      "  --event-table <name>           Event metadata table name (or EVENT_METADATA_TABLE env)",
      "  --skip-cache                   Do not create the admin roster cache table",
      "  --skip-event                   Do not create the event metadata table",
      "  --skip-ttl                     Do not enable TTL on any table",
      "  --skip-ttl-nextauth            Do not enable TTL on the NextAuth table",
      "  --skip-ttl-cache               Do not enable TTL on the cache table",
    ].join("\n"),
  );
};

let region = process.env.REGION_AWS || process.env.AWS_REGION || "";
let nextAuthTable = process.env.NEXTAUTH_TABLE || "NextAuth";
let cacheTable = process.env.ADMIN_ROSTER_CACHE_TABLE || "";
let eventTable = process.env.EVENT_METADATA_TABLE || "";
let skipCache = false;
let skipEvent = false;
let skipTtl = false;
let skipTtlNextAuth = false;
let skipTtlCache = false;

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
  if (arg === "--nextauth-table" && args[i + 1]) {
    nextAuthTable = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--cache-table" && args[i + 1]) {
    cacheTable = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--event-table" && args[i + 1]) {
    eventTable = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--skip-cache") {
    skipCache = true;
    continue;
  }
  if (arg === "--skip-event") {
    skipEvent = true;
    continue;
  }
  if (arg === "--skip-ttl" || arg === "--no-ttl") {
    skipTtl = true;
    continue;
  }
  if (arg === "--skip-ttl-nextauth") {
    skipTtlNextAuth = true;
    continue;
  }
  if (arg === "--skip-ttl-cache") {
    skipTtlCache = true;
    continue;
  }
}

if (!region) {
  console.error("Missing region. Set REGION_AWS/AWS_REGION or pass --region.");
  usage();
  process.exit(1);
}

if (!nextAuthTable) {
  console.error("Missing NEXTAUTH table name. Set NEXTAUTH_TABLE or pass --nextauth-table.");
  usage();
  process.exit(1);
}

const client = new DynamoDBClient({ region });

async function ensureTtlEnabled({ tableName, attributeName, skip }) {
  if (skip || skipTtl) return;
  try {
    const res = await client.send(new DescribeTimeToLiveCommand({ TableName: tableName }));
    const status = res.TimeToLiveDescription?.TimeToLiveStatus;
    if (status === "ENABLED" || status === "ENABLING") {
      console.log(`TTL already ${status?.toLowerCase()} on ${tableName}.`);
      return;
    }
  } catch (err) {
    console.warn(`Unable to read TTL status for ${tableName}, continuing to set TTL.`, err?.message || err);
  }
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: {
        AttributeName: attributeName,
        Enabled: true,
      },
    }),
  );
  console.log(`TTL enabled on ${tableName} for attribute ${attributeName}.`);
}

async function describeTable(tableName) {
  try {
    const res = await client.send(new DescribeTableCommand({ TableName: tableName }));
    return res.Table || null;
  } catch (err) {
    const name = err?.name || err?.code;
    if (name === "ResourceNotFoundException") return null;
    throw err;
  }
}

function hasKeySchema(table, hash, range) {
  const keys = Array.isArray(table?.KeySchema) ? table.KeySchema : [];
  const hashOk = keys.some((k) => k.AttributeName === hash && k.KeyType === "HASH");
  const rangeOk = range ? keys.some((k) => k.AttributeName === range && k.KeyType === "RANGE") : true;
  return hashOk && rangeOk;
}

function hasGsi(table, indexName, hash, range) {
  const gsis = Array.isArray(table?.GlobalSecondaryIndexes) ? table.GlobalSecondaryIndexes : [];
  return gsis.some((idx) => {
    if (idx.IndexName !== indexName) return false;
    const keys = Array.isArray(idx.KeySchema) ? idx.KeySchema : [];
    const hashOk = keys.some((k) => k.AttributeName === hash && k.KeyType === "HASH");
    const rangeOk = keys.some((k) => k.AttributeName === range && k.KeyType === "RANGE");
    return hashOk && rangeOk;
  });
}

async function ensureNextAuthTable() {
  const existing = await describeTable(nextAuthTable);
  if (existing) {
    const keyOk = hasKeySchema(existing, "pk", "sk");
    const gsiOk = hasGsi(existing, "GSI1", "GSI1PK", "GSI1SK");
    if (!keyOk || !gsiOk) {
      console.warn(
        [
          `Table ${nextAuthTable} exists but does not match NextAuth schema.`,
          `Expected pk/sk keys and GSI1 (GSI1PK/GSI1SK).`,
        ].join(" "),
      );
    } else {
      console.log(`NextAuth table exists: ${nextAuthTable}`);
    }
    await ensureTtlEnabled({ tableName: nextAuthTable, attributeName: "expires", skip: skipTtlNextAuth });
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: nextAuthTable,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );
  console.log(`CreateTable issued for NextAuth table: ${nextAuthTable}. Waiting for ACTIVE...`);
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: nextAuthTable });
  console.log(`NextAuth table is ACTIVE: ${nextAuthTable}`);
  await ensureTtlEnabled({ tableName: nextAuthTable, attributeName: "expires", skip: skipTtlNextAuth });
}

async function ensureRosterCacheTable() {
  if (skipCache) {
    console.log("Skipping admin roster cache table creation.");
    return;
  }
  if (!cacheTable) {
    console.log("ADMIN_ROSTER_CACHE_TABLE not set; skipping admin roster cache table creation.");
    return;
  }

  const existing = await describeTable(cacheTable);
  if (existing) {
    const keyOk = hasKeySchema(existing, "pk", "sk");
    if (!keyOk) {
      console.warn(`Table ${cacheTable} exists but does not match cache schema (pk/sk).`);
    } else {
      console.log(`Admin roster cache table exists: ${cacheTable}`);
    }
    await ensureTtlEnabled({ tableName: cacheTable, attributeName: "expiresAtEpochSec", skip: skipTtlCache });
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: cacheTable,
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
  console.log(`CreateTable issued for admin roster cache table: ${cacheTable}. Waiting for ACTIVE...`);
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: cacheTable });
  console.log(`Admin roster cache table is ACTIVE: ${cacheTable}`);
  await ensureTtlEnabled({ tableName: cacheTable, attributeName: "expiresAtEpochSec", skip: skipTtlCache });
}

async function ensureEventMetadataTable() {
  if (skipEvent) {
    console.log("Skipping event metadata table creation.");
    return;
  }
  if (!eventTable) {
    console.log("EVENT_METADATA_TABLE not set; skipping event metadata table creation.");
    return;
  }

  const existing = await describeTable(eventTable);
  if (existing) {
    const keyOk = hasKeySchema(existing, "lockAddress", null);
    if (!keyOk) {
      console.warn(`Table ${eventTable} exists but does not match event metadata schema (lockAddress).`);
    } else {
      console.log(`Event metadata table exists: ${eventTable}`);
    }
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: eventTable,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [{ AttributeName: "lockAddress", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "lockAddress", AttributeType: "S" }],
    }),
  );
  console.log(`CreateTable issued for event metadata table: ${eventTable}. Waiting for ACTIVE...`);
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: eventTable });
  console.log(`Event metadata table is ACTIVE: ${eventTable}`);
}

async function main() {
  await ensureNextAuthTable();
  await ensureRosterCacheTable();
  await ensureEventMetadataTable();
}

main().catch((err) => {
  console.error("Failed to set up DynamoDB tables.", err);
  process.exit(1);
});
