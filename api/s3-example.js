const { getS3Client } = require('../backend/awsClient');
const { ListBucketsCommand } = require('@aws-sdk/client-s3');

module.exports = async function handler(req, res) {
  try {
    const s3 = getS3Client();
    const data = await s3.send(new ListBucketsCommand({}));
    return res.status(200).json({
      success: true,
      buckets: data.Buckets || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
