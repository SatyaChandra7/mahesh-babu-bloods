import { S3Client } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

export interface S3ClientConfig {
  region?: string;
  roleArn?: string;
}

/**
 * Creates and returns an AWS S3 Client instance configured with Vercel OIDC credentials.
 */
export function createS3Client(config: S3ClientConfig = {}): S3Client {
  const region = config.region || process.env.AWS_REGION || 'us-east-1';
  const roleArn = config.roleArn || process.env.AWS_ROLE_ARN;

  if (roleArn) {
    return new S3Client({
      region,
      credentials: awsCredentialsProvider({
        roleArn,
      }),
    });
  }

  return new S3Client({ region });
}

export const s3Client = createS3Client();
