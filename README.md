# PGP Community Demo

This project demonstrates a token‑gated membership site built with [Unlock Protocol](https://unlock-protocol.com/) (via Unlock Paywall), [Privy](https://www.privy.io/) wallet infrastructure and several AWS services. Members who hold a valid NFT from the configured Unlock lock can access private content hosted in an S3 bucket. CloudFront signed URLs and a Lambda function secure the content.

A demo of the deployed site is available at [https://pgpforcrypto.org/community](https://pgpforcrypto.org/community).

## Dependencies
Core Dependencies:
next@15.4.4
react@19.1.1
react-dom@19.1.1
@aws-sdk/client-secrets-manager@3.421.0
@aws-sdk/cloudfront-signer@3.421.0
@privy-io/react-auth@2.20.0
@unlock-protocol/networks@0.0.25
@unlock-protocol/paywall@0.8.1
@unlock-protocol/unlock-js@0.51.2
ethers@6.15.0

Development Dependencies:
@tailwindcss/postcss@4
@types/node@24
@types/react@19
@types/react-dom@19
esbuild@0.19.12
tailwindcss@4
typescript@5

Mac commands to install dependencies:
```bash
brew install node
npm install
npm install -g tailwindcss
npm install --save @aws-sdk/types
npm install -g serve
```

Command to build (be sure to create .env.local first):
```bash
npm run build
```

Command to test locally:
```bash
npx serve out
```
Test at http://localhost:3000/community


## Overview

- **Unlock Protocol & Paywall** – manages the membership NFTs and purchase flow via Unlock Paywall. In this example a lock on Base network costs `0.10` USDC and keys expire after 30 days ([contract](https://basescan.org/address/0xed16cd934780a48697c2fd89f1b13ad15f0b64e1)).
- **Privy** – provides embedded wallet functionality and user login.
- **AWS** – S3 stores the restricted content, CloudFront serves it via signed URLs, Secrets Manager holds the CloudFront private key, and a Lambda function generates signed URLs.

## Deployment Steps

1. **Create a Lock on Unlock Protocol**
   - Deploy a lock or use the demo lock above. Note the lock address, price and network.
2. **Register a Privy Application**
   - Sign up for a free Privy developer account and obtain your `Privy App ID`.
3. **Set Up S3**
   - Create a bucket for member‑only files and upload your HTML/asset content.
   - After the CloudFront distribution is created (next step), apply a bucket policy like the following, replacing the ARNs with your bucket and distribution:

```json
{
  "Version": "2008-10-17",
  "Id": "PolicyForCloudFrontPrivateContent",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::pgpcommunity/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::860091316962:distribution/E2G5A1ETHRE74H"
        }
      }
    }
  ]
}
```

4. **Create a CloudFront Distribution**
   - Configure an Origin Access Control (OAC) for the S3 origin.
   - Generate a public/private key pair and store the private key in Secrets Manager:

```bash
openssl genrsa -traditional -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
aws secretsmanager create-secret --name pgpcommunity_pk --secret-string file://private_key.pem
```

   - Create a CloudFront Public Key using `public_key.pem`, then create a Key Group containing that key. In your distribution behavior enable **Trusted Key Groups** and select the Key Group.

5. **IAM Policy and Role for Lambda**
   - Create a policy (for example `pgpcommunity_secrets_policy`) allowing access to the secret and CloudWatch Logs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:860091316962:secret:pgpcommunity_pk-4s9DKg"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

   - Attach this policy to an IAM role for Lambda (e.g. `pgpcommunity_lambda_role`).

6. **Deploy the Lambda Function**
   - Clone this repository and install dependencies:

```bash
npm install
```

   - Create `.env.local` in the project root with your configuration:

```
NEXT_PUBLIC_PRIVY_APP_ID=<YOUR PRIVY APP ID>
NEXT_PUBLIC_SIGNER_URL=https://YOUR_LAMBDA_FUNCTION_ID.lambda-url.us-east-1.on.aws/
NEXT_PUBLIC_LOCK_ADDRESS=0xed16cd934780a48697c2fd89f1b13ad15f0b64e1
NEXT_PUBLIC_UNLOCK_ADDRESS=0xd0b14797b9D08493392865647384974470202A78
NEXT_PUBLIC_BASE_NETWORK_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

   - Build the project and package the Lambda code:

```bash
npm run build:lambda
```

   - Upload `generateSignedUrl.zip` from the project root when creating the Lambda function (runtime Node.js 24.x) and use the IAM role from the previous step. Set the following environment variables (adjust for your resources):

```
BASE_RPC_URL=https://mainnet.base.org
CLOUDFRONT_DOMAIN=df4eds0i0fgq.cloudfront.net
KEY_PAIR_ID=KERO2MLM81YXV
LOCK_ADDRESS=0xed16cd934780a48697c2fd89f1b13ad15f0b64e1
NETWORK_ID=8453
PRIVATE_KEY_SECRET_ARN=arn:aws:secretsmanager:us-east-1:860091316962:secret:pgpcommunity_pk-4s9DKg
```

   - Create a function URL with `auth_type = NONE` and configure CORS for your domains (e.g. `http://localhost:3000`, `https://www.pgpforcrypto.org`).

7. **Build and Deploy the Frontend**
   - Build the static site:

```bash
npm run build
```

   - Upload the contents of `out/community` to another S3 bucket that serves your public website (for example `https://pgpforcrypto.org`).

## Usage

Visit your deployed site and connect a wallet. Click **Get Membership** to launch the Unlock Paywall and purchase a key. The paywall handles wallet funding automatically, so there is no separate **Fund Wallet** button or manual funding step. If the wallet already holds a valid membership NFT, the app requests a signed URL from the Lambda function and displays the restricted content in an iframe.

The demo lock uses USDC on Base, and the paywall can fund wallets as needed before completing the purchase.

---

This project illustrates how Unlock Protocol, Privy and AWS services can be combined to power an NFT‑gated community.

