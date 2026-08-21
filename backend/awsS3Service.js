const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getS3Client } = require('./awsClient');

/**
 * Uploads a file buffer or stream to an AWS S3 bucket.
 * 
 * @param {Buffer|Uint8Array|Blob|string} body - File content buffer or string
 * @param {string} key - S3 object key (filename or path in bucket)
 * @param {string} [mimeType='application/octet-stream'] - MIME type of the file
 * @param {string} [bucket] - S3 bucket name (defaults to process.env.AWS_S3_BUCKET or process.env.S3_BUCKET_NAME)
 * @returns {Promise<{success: boolean, key: string, url: string, location: string}>} Upload result
 */
async function uploadToS3(body, key, mimeType = 'application/octet-stream', bucket) {
  const bucketName = bucket || process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('S3 bucket name is missing. Please set AWS_S3_BUCKET or S3_BUCKET_NAME in environment variables.');
  }

  const s3 = getS3Client();
  const region = process.env.AWS_REGION || 'us-east-1';

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: mimeType,
  });

  await s3.send(command);

  const url = `https://${bucketName}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;

  return {
    success: true,
    key,
    bucket: bucketName,
    region,
    url,
    location: url,
  };
}

/**
 * Deletes an object from an AWS S3 bucket.
 * 
 * @param {string} key - S3 object key
 * @param {string} [bucket] - S3 bucket name
 * @returns {Promise<{success: boolean, key: string}>} Delete result
 */
async function deleteFromS3(key, bucket) {
  const bucketName = bucket || process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('S3 bucket name is missing. Please set AWS_S3_BUCKET or S3_BUCKET_NAME in environment variables.');
  }

  const s3 = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3.send(command);

  return {
    success: true,
    key,
    bucket: bucketName,
  };
}

module.exports = {
  uploadToS3,
  deleteFromS3,
};
