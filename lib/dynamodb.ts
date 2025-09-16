import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { AWS_REGION, NEXTAUTH_TABLE } from "@/lib/config";

const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
export const documentClient = DynamoDBDocument.from(dynamoClient);
export const TABLE_NAME = NEXTAUTH_TABLE || "NextAuth";
