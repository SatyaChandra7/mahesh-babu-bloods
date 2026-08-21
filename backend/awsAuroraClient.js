const { Client } = require('pg');

/**
 * Generates a dynamic IAM authentication token for AWS RDS PostgreSQL.
 *
 * @param {Object} options
 * @param {string} options.region - AWS Region (defaults to process.env.AWS_REGION || 'ap-south-1')
 * @param {string} options.hostname - RDS Endpoint Hostname
 * @param {number} [options.port=5432] - Database port
 * @param {string} [options.username='postgres'] - Database user
 * @returns {Promise<string>} Auth token password
 */
async function getRDSIAMToken(options = {}) {
  const region = options.region || process.env.AWS_REGION || 'ap-south-1';
  const hostname = options.hostname || process.env.RDS_HOSTNAME || 'database-1-instance-1.cz0siasmowue.ap-south-1.rds.amazonaws.com';
  const port = options.port || parseInt(process.env.RDS_PORT || '5432', 10);
  const username = options.username || process.env.RDS_USERNAME || 'postgres';

  try {
    const { Signer } = require('@aws-sdk/rds-signer');
    const signer = new Signer({ region, hostname, port, username });
    return await signer.getAuthToken();
  } catch (err) {
    const AWS = require('aws-sdk');
    AWS.config.update({ region });
    const signer = new AWS.RDS.Signer({ region, hostname, port, username });
    return signer.getAuthToken({});
  }
}

/**
 * Creates and connects a pg Client using AWS RDS IAM Authentication.
 *
 * @param {Object} [config]
 * @returns {Promise<Client>} Connected pg Client
 */
async function connectRDSPostgres(config = {}) {
  const region = config.region || process.env.AWS_REGION || 'ap-south-1';
  const hostname = config.hostname || process.env.RDS_HOSTNAME || 'database-1-instance-1.cz0siasmowue.ap-south-1.rds.amazonaws.com';
  const port = config.port || parseInt(process.env.RDS_PORT || '5432', 10);
  const database = config.database || process.env.RDS_DATABASE || 'postgres';
  const username = config.username || process.env.RDS_USERNAME || 'postgres';

  const password = await getRDSIAMToken({ region, hostname, port, username });

  const client = new Client({
    host: hostname,
    port,
    database,
    user: username,
    password,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  return client;
}

module.exports = {
  getRDSIAMToken,
  connectRDSPostgres,
};
