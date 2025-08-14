import { createSign } from 'crypto';

export function getSignedUrl(params: {
  url: string;
  keyPairId: string;
  privateKey: string;
  expires: number; // epoch seconds
}): string {
  const policy = {
    Statement: [
      {
        Resource: params.url,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': params.expires },
        },
      },
    ],
  };

  const policyString = JSON.stringify(policy);
  const sign = createSign('RSA-SHA1');
  sign.update(policyString);
  sign.end();
  const signature = sign.sign(params.privateKey);

  const policyBase64 = Buffer.from(policyString).toString('base64');
  const signatureBase64 = signature.toString('base64');

  const urlSafe = (str: string) =>
    str.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');

  const signedUrl =
    params.url +
    `?Policy=${urlSafe(policyBase64)}&Signature=${urlSafe(signatureBase64)}&Key-Pair-Id=${params.keyPairId}`;

  return signedUrl;
}
