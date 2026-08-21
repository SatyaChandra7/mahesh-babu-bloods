const { S3Client } = require('@aws-sdk/client-s3');
const { awsCredentialsProvider } = require('@vercel/oidc-aws-credentials-provider');

/**
 * Initializes and returns an AWS S3 Client instance.
 * Automatically handles Vercel OIDC passwordless authentication via AWS_ROLE_ARN
 * or falls back to static AWS credentials / standard SDK credential resolution.
 *
 * @param {Object} [config] - Optional configuration overrides
 * @param {string} [config.region] - AWS Region (defaults to process.env.AWS_REGION or 'us-east-1')
 * @param {string} [config.roleArn] - IAM Role ARN (defaults to process.env.AWS_ROLE_ARN)
 * @returns {S3Client} Configured AWS S3 Client
 */
function getS3Client(config = {}) {
  const region = config.region || process.env.AWS_REGION || 'us-east-1';
  const roleArn = config.roleArn || process.env.AWS_ROLE_ARN;

  const clientOptions = { region };

  if (roleArn) {
    // Authenticate using Vercel OIDC Web Identity Credentials Provider
    clientOptions.credentials = awsCredentialsProvider({
      roleArn,
    });
  } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    // Fallback to explicit static credentials if provided
    clientOptions.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return new S3Client(clientOptions);
}

module.exports = {
  getS3Client,
};
