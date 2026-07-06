// This file is the Vercel Serverless Function entry point.
// It re-exports the Express app from backend/index.js so that
// Vercel can detect and run it automatically.

const app = require('./backend/index.js');

module.exports = app;
