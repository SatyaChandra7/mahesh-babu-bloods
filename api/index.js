// Explicitly reference database drivers so Vercel's NFT bundler includes them in the serverless output zip
try { require('pg'); } catch (e) {}
try { require('pg-hstore'); } catch (e) {}
try { require('sqlite3'); } catch (e) {}

const app = require('../backend/index.js');

module.exports = app;

