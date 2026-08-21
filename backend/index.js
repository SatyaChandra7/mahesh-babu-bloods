// Error handling for unhandled rejections/exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const multer = require('multer');
const { Sequelize, DataTypes, Op } = require('sequelize');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');


let pgDriver = null;

try { pgDriver = require('pg'); } catch (e) {}
try { require('pg-hstore'); } catch (e) {}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
const GALLERY_PATH = process.env.GALLERY_FOLDER || 'our work';

// Normalize Vercel Serverless Function rewrites (e.g. /api/index.js/v1/... -> /api/v1/...)
app.use((req, res, next) => {
    const rawUrl = req.url || '/';
    if (rawUrl.startsWith('/api/index.js')) {
        const remainder = rawUrl.substring('/api/index.js'.length);
        const invokePath = req.headers['x-matched-path'] || req.headers['x-invoke-path'] || req.headers['x-original-uri'];
        
        if (remainder && remainder.startsWith('/')) {
            req.url = '/api' + remainder;
        } else if (invokePath && invokePath !== '/api/index.js' && invokePath !== '/api') {
            req.url = invokePath + (remainder || '');
        } else if (!remainder || remainder.startsWith('?')) {
            req.url = '/health' + (remainder || '');
        } else {
            req.url = remainder || '/';
        }
    }
    next();
});

// Middleware
app.use(helmet({ 
    contentSecurityPolicy: false, // Disabled to prevent breaking frontend assets/images
    crossOriginEmbedderPolicy: false 
}));

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per `window`
    message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(generalLimiter);

// Dynamic CORS Configuration
const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
    : [];

app.use(cors({ 
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin) return callback(null, true);
        
        // If CORS_ORIGIN is '*' or empty/unspecified, allow all requesting origins dynamically
        if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
            return callback(null, origin);
        }
        
        // Check allowed origins, production domains, vercel domains, or localhost
        const isAllowed = allowedOrigins.includes(origin) || 
                          /^https:\/\/(www\.)?(mbbloods\.org|maheshbabubloods\.org)$/i.test(origin) ||
                          /^https:\/\/.*\.vercel\.app$/i.test(origin) || 
                          /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

        if (isAllowed) {
            return callback(null, origin);
        }
        return callback(null, origin);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/admin-frontend', express.static(path.join(__dirname, '..', 'admin-frontend')));
app.use('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin-frontend', 'admin.html')));
app.use('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin-frontend', 'admin.html')));

// Serverless (Vercel) Auto-Initialization Middleware
app.use(async (req, res, next) => {
    if (!isInitialized) {
        try {
            await initializeApp();
        } catch (err) {
            console.error('Serverless auto-initialization error:', err);
        }
    }
    next();
});

// SQL Database Initialization (Sequelize + SQLite or Postgres)
let sequelize;

const JSON_DB_FILE = process.env.VERCEL || process.env.NODE_ENV === 'production'
    ? path.join('/tmp', 'donors_persistent.json')
    : path.join(__dirname, 'donors.json');

function loadDonorsFromJSON() {
    try {
        if (fs.existsSync(JSON_DB_FILE)) {
            const raw = fs.readFileSync(JSON_DB_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.error('Error loading JSON DB:', e.message);
    }
    return [];
}

function saveDonorToJSON(donor) {
    try {
        const existing = loadDonorsFromJSON();
        const foundIndex = existing.findIndex(d => String(d.phoneNumber) === String(donor.phoneNumber) && String(d.fullName) === String(donor.fullName));
        const donorData = {
            id: donor.id || Date.now(),
            fullName: donor.fullName,
            dateOfBirth: donor.dateOfBirth,
            gender: donor.gender,
            weight: donor.weight,
            phoneNumber: donor.phoneNumber,
            bloodGroup: donor.bloodGroup,
            state: donor.state || '',
            district: donor.district || '',
            mandal: donor.mandal || '',
            village: donor.village || '',
            pincode: donor.pincode || '',
            registeredAt: donor.registeredAt || new Date(),
            isVerified: donor.isVerified || false
        };
        if (foundIndex !== -1) {
            existing[foundIndex] = { ...existing[foundIndex], ...donorData };
        } else {
            existing.unshift(donorData);
        }
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
        console.error('Error saving to JSON DB:', e.message);
    }
}

function saveAllDonorsToJSON(donors) {
    try {
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(donors, null, 2), 'utf-8');
    } catch (e) {
        console.error('saveAllDonorsToJSON error:', e.message);
    }
}

function toggleDonorVerificationInJSON(id) {
    try {
        const list = loadDonorsFromJSON();
        const strId = String(id).trim();
        const target = list.find(d => 
            String(d.id).trim() === strId || 
            String(d.phoneNumber).trim() === strId
        );
        if (target) {
            target.isVerified = !target.isVerified;
            saveAllDonorsToJSON(list);
            return target;
        }
        if (list.length > 0) {
            const parsed = parseInt(strId, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed <= list.length) {
                const item = list[list.length - parsed];
                if (item) {
                    item.isVerified = !item.isVerified;
                    saveAllDonorsToJSON(list);
                    return item;
                }
            }
        }
    } catch (e) {
        console.error('toggleDonorVerificationInJSON error:', e.message);
    }
    return null;
}

function deleteDonorFromJSON(id) {
    try {
        const list = loadDonorsFromJSON();
        const strId = String(id).trim();
        const filtered = list.filter(d => 
            String(d.id).trim() !== strId && 
            String(d.phoneNumber).trim() !== strId
        );
        saveAllDonorsToJSON(filtered);
    } catch (e) {
        console.error('deleteDonorFromJSON error:', e.message);
    }
}

const fallbackDonorsStore = loadDonorsFromJSON();

function createFallbackSequelize() {
    return {
        authenticate: async () => console.warn('Database connection unavailable (using fallback mode)'),
        sync: async () => console.warn('Database sync unavailable (using fallback mode)'),
        define: (modelName) => ({
            name: modelName,
            findOrCreate: async (options) => {
                const existing = fallbackDonorsStore.find(d => d.phoneNumber === options?.where?.phoneNumber);
                if (existing) return [existing, false];
                const newObj = { ...options?.defaults, id: Date.now() };
                fallbackDonorsStore.unshift(newObj);
                saveDonorToJSON(newObj);
                return [newObj, true];
            },
            create: async (data) => {
                const newObj = { ...data, id: Date.now(), registeredAt: new Date() };
                fallbackDonorsStore.unshift(newObj);
                saveDonorToJSON(newObj);
                return newObj;
            },
            findAll: async () => loadDonorsFromJSON(),
            findOne: async () => loadDonorsFromJSON()[0] || null,
            findByPk: async (id) => loadDonorsFromJSON().find(d => String(d.id) === String(id)) || null,
            count: async () => loadDonorsFromJSON().length,
            destroy: async (options) => {
                if (options?.where?.id) {
                    const idx = fallbackDonorsStore.findIndex(d => String(d.id) === String(options.where.id));
                    if (idx !== -1) fallbackDonorsStore.splice(idx, 1);
                    try { fs.writeFileSync(JSON_DB_FILE, JSON.stringify(fallbackDonorsStore, null, 2)); } catch (e) {}
                }
                return 1;
            },
            save: async () => {}
        })
    };
}

let isDbConnected = false;
let dbDialect = 'sqlite';

function initSequelize() {
    let dbUrl = process.env.DATABASE_URL;

    // Check if DATABASE_URL is set and does not contain placeholders
    if (dbUrl && !dbUrl.includes('<YOUR_AWS_RDS_PASSWORD>')) {
        console.log('Attempting PostgreSQL database connection via DATABASE_URL');
        try {
            let pgModule = pgDriver;
            if (!pgModule) {
                try { pgModule = require('pg'); } catch (e) {}
            }
            // Strip sslmode query parameter from URL to allow custom dialectOptions.ssl to handle SSL
            const cleanDbUrl = dbUrl.replace(/[?&]sslmode=[^&]+/gi, '');
            const options = {
                dialect: 'postgres',
                dialectOptions: {
                    ssl: {
                        require: true,
                        rejectUnauthorized: false
                    },
                    connectTimeout: 5000
                },
                logging: false,
                pool: { max: 3, min: 0, acquire: 5000, idle: 10000 }
            };
            if (pgModule) options.dialectModule = pgModule;
            dbDialect = 'postgresql';
            return new Sequelize(cleanDbUrl, options);
        } catch (err) {
            console.error('Postgres Sequelize Initialization Error:', err.message);
        }
    }

    // AWS RDS Host Configuration
    const rdsHost = process.env.RDS_HOSTNAME || 'database-1-instance-1.cz0siasmowue.ap-south-1.rds.amazonaws.com';
    const rdsUser = process.env.RDS_USERNAME || 'postgres';
    const rdsPass = process.env.RDS_PASSWORD;
    const rdsDb = process.env.RDS_DATABASE || 'postgres';
    const rdsPort = parseInt(process.env.RDS_PORT || '5432', 10);

    if (rdsHost && rdsPass) {
        console.log(`Attempting AWS RDS PostgreSQL connection to ${rdsHost}:${rdsPort}/${rdsDb}`);
        try {
            const options = {
                host: rdsHost,
                port: rdsPort,
                database: rdsDb,
                username: rdsUser,
                password: rdsPass,
                dialect: 'postgres',
                dialectOptions: {
                    ssl: { require: true, rejectUnauthorized: false }
                },
                logging: false,
                pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
            };
            if (pgDriver) options.dialectModule = pgDriver;
            dbDialect = 'postgresql';
            return new Sequelize(rdsDb, rdsUser, rdsPass, options);
        } catch (err) {
            console.error('AWS RDS Direct Connection Error:', err.message);
        }
    }

    if (rdsHost && (process.env.AWS_REGION || process.env.AWS_ROLE_ARN)) {
        console.log(`Attempting AWS RDS IAM Authentication connection to ${rdsHost}`);
        try {
            const { getRDSIAMToken } = require('./awsAuroraClient');
            const options = {
                host: rdsHost,
                port: rdsPort,
                database: rdsDb,
                username: rdsUser,
                dialect: 'postgres',
                dialectOptions: {
                    ssl: { require: true, rejectUnauthorized: false }
                },
                logging: false,
                pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
                hooks: {
                    beforeConnect: async (config) => {
                        try {
                            config.password = await getRDSIAMToken({
                                region: process.env.AWS_REGION || 'ap-south-1',
                                hostname: rdsHost,
                                port: rdsPort,
                                username: rdsUser,
                            });
                        } catch (e) {
                            console.error('Failed to refresh RDS IAM token:', e.message);
                        }
                    }
                }
            };
            if (pgDriver) options.dialectModule = pgDriver;
            dbDialect = 'postgresql';
            return new Sequelize(rdsDb, rdsUser, null, options);
        } catch (err) {
            console.error('AWS RDS IAM Connection Setup Error:', err.message);
        }
    }

    console.log('DATABASE_URL not set or invalid. Falling back to SQLite database connection');
    dbDialect = 'sqlite';
    const dbPath = process.env.VERCEL || process.env.NODE_ENV === 'production' 
        ? ':memory:' 
        : path.join(__dirname, 'database.sqlite');

    try {
        let sqliteOptions = {
            dialect: 'sqlite',
            storage: dbPath,
            logging: false
        };
        try {
            sqliteOptions.dialectModule = require('sqlite3');
        } catch (e) {}
        return new Sequelize(sqliteOptions);
    } catch (err) {
        console.error('SQLite Sequelize Initialization Error:', err.message);
        try {
            return new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
        } catch (e2) {
            console.error('Fallback Sequelize Initialization Error:', e2.message);
            return createFallbackSequelize();
        }
    }
}

sequelize = initSequelize() || createFallbackSequelize();

// Donor Model
const Donor = sequelize.define('Donor', {
    fullName: { type: DataTypes.STRING, allowNull: false },
    dateOfBirth: DataTypes.DATEONLY,
    gender: DataTypes.STRING,
    weight: DataTypes.STRING,
    phoneNumber: { type: DataTypes.STRING, allowNull: false },
    bloodGroup: { type: DataTypes.STRING, allowNull: false },
    state: DataTypes.STRING,
    district: DataTypes.STRING,
    mandal: DataTypes.STRING,
    village: DataTypes.STRING,
    pincode: DataTypes.STRING,
    registeredAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// Feedback Model
const Feedback = sequelize.define('Feedback', {
    name: { type: DataTypes.STRING, allowNull: false },
    rating: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
    comment: { type: DataTypes.TEXT, allowNull: false },
    isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// GalleryImage Model (Database Storage for Our Work Gallery)
const GalleryImage = sequelize.define('GalleryImage', {
    filename: { type: DataTypes.STRING, allowNull: false, unique: true },
    imageData: { type: DataTypes.TEXT, allowNull: false },
    mimeType: { type: DataTypes.STRING, defaultValue: 'image/jpeg' },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});


// Admin Config
const JWT_SECRET = process.env.JWT_SECRET || 'mb_bloods_admin_jwt_secret_key_stable_2026';
const ADMIN_USERS = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS }
].filter(u => u.username && u.password);

// Whitelisted WhatsApp Numbers for Admin Login
const WHITELISTED_NUMBERS = [
    process.env.ADMIN_WHATSAPP_1 || '919948550301',
    process.env.ADMIN_WHATSAPP_2 || '919491463888'
];
let adminOtps = new Map(); // Temporary OTP storage

// Serve static files (HTML, CSS, JS, Assets)
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..', 'admin-frontend')));

// Root route
app.get('/', (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const frontendPath = path.join(__dirname, '..', 'frontend', 'index.html');
        if (fs.existsSync(frontendPath)) {
            return res.sendFile(frontendPath);
        }
    }
    res.json({
        status: 'ok',
        service: 'Mahesh Babu Bloods Backend API Service',
        health: '/health',
        initialized: isInitialized,
        database: isDbConnected ? dbDialect : (dbDialect === 'postgresql' ? 'postgresql (disconnected)' : 'sqlite'),
        dbConnected: isDbConnected,
        dbError: lastDbError,
        hasSheets: !!sheets
    });
});

// Google Sheets Config
const SERVICE_ACCOUNT_FILE = path.join(__dirname, '..', 'service-account.json');
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

let sheets;
let isInitialized = false;

async function syncLocalImagesToDB() {
    try {
        const repoDir = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH);
        if (!fs.existsSync(repoDir)) return;
        const localFiles = fs.readdirSync(repoDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        if (localFiles.length === 0) return;

        let dbFilenames = new Set();
        if (isDbConnected && GalleryImage) {
            try {
                const dbRecords = await GalleryImage.findAll({ attributes: ['filename'] });
                dbRecords.forEach(r => dbFilenames.add(r.filename));
            } catch (e) {
                console.error('Error querying GalleryImage table during auto-sync:', e.message);
            }
        }

        let syncedCount = 0;
        for (const filename of localFiles) {
            if (!dbFilenames.has(filename)) {
                try {
                    const filePath = path.join(repoDir, filename);
                    const fileBuffer = fs.readFileSync(filePath);
                    const ext = path.extname(filename).toLowerCase().replace('.', '');
                    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
                    const base64Data = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

                    if (isDbConnected && GalleryImage) {
                        await GalleryImage.findOrCreate({
                            where: { filename },
                            defaults: {
                                filename,
                                imageData: base64Data,
                                mimeType
                            }
                        });
                        syncedCount++;
                    }
                } catch (err) {
                    console.error(`Failed to auto-sync image ${filename}:`, err.message);
                }
            }
        }
        if (syncedCount > 0) {
            console.log(`✅ Auto-synced ${syncedCount} gallery images to database.`);
        }
    } catch (err) {
        console.error('syncLocalImagesToDB error:', err.message);
    }
}

const FEEDBACKS_FILE = path.join(__dirname, 'feedbacks.json');

function loadFeedbacksFromJSON() {
    try {
        if (fs.existsSync(FEEDBACKS_FILE)) {
            const data = fs.readFileSync(FEEDBACKS_FILE, 'utf8');
            return JSON.parse(data) || [];
        }
    } catch (e) {
        console.error('loadFeedbacksFromJSON error:', e.message);
    }
    return [];
}

function saveFeedbackToJSON(fb) {
    try {
        const list = loadFeedbacksFromJSON();
        list.unshift(fb);
        fs.writeFileSync(FEEDBACKS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.error('saveFeedbackToJSON error:', e.message);
    }
}

function saveAllFeedbacksToJSON(feedbacksList) {
    try {
        fs.writeFileSync(FEEDBACKS_FILE, JSON.stringify(feedbacksList, null, 2), 'utf8');
    } catch (e) {
        console.error('saveAllFeedbacksToJSON error:', e.message);
    }
}

function toggleFeedbackApprovalInJSON(id) {
    try {
        const list = loadFeedbacksFromJSON();
        const strId = String(id).trim();
        const target = list.find(f => String(f.id).trim() === strId || String(f.name).trim().toLowerCase() === strId.toLowerCase());
        if (target) {
            target.isApproved = !target.isApproved;
            saveAllFeedbacksToJSON(list);
            return target;
        }
    } catch (e) {
        console.error('toggleFeedbackApprovalInJSON error:', e.message);
    }
    return null;
}

function deleteFeedbackFromJSON(id) {
    try {
        const list = loadFeedbacksFromJSON();
        const strId = String(id).trim();
        const filtered = list.filter(f => String(f.id).trim() !== strId && String(f.name).trim().toLowerCase() !== strId.toLowerCase());
        saveAllFeedbacksToJSON(filtered);
    } catch (e) {
        console.error('deleteFeedbackFromJSON error:', e.message);
    }
}

async function syncFeedbacksToDB() {
    try {
        const jsonFbs = loadFeedbacksFromJSON();
        if (jsonFbs.length > 0 && isDbConnected && Feedback) {
            for (const fb of jsonFbs) {
                if (!fb.name || !fb.comment) continue;
                await Feedback.findOrCreate({
                    where: { name: fb.name, comment: fb.comment },
                    defaults: {
                        name: fb.name,
                        rating: fb.rating || 5,
                        comment: fb.comment,
                        isApproved: fb.isApproved !== undefined ? fb.isApproved : true,
                        createdAt: fb.createdAt ? new Date(fb.createdAt) : new Date()
                    }
                }).catch(e => {});
            }
            console.log(`✅ Synced ${jsonFbs.length} feedbacks to database.`);
        }
    } catch (e) {
        console.error('syncFeedbacksToDB error:', e.message);
    }
}

const FEEDBACK_SHEET_NAME = 'Feedbacks';

async function ensureFeedbackSheetExists() {
    if (!sheets || !SPREADSHEET_ID) return false;
    try {
        const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetTitles = (spreadsheetInfo.data.sheets || []).map(s => s.properties.title);
        if (!sheetTitles.includes(FEEDBACK_SHEET_NAME)) {
            console.log(`Creating missing sheet tab: "${FEEDBACK_SHEET_NAME}"...`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: FEEDBACK_SHEET_NAME }
                        }
                    }]
                }
            });
            const header = ['ID', 'Name', 'Rating', 'Comment', 'Is Approved', 'Created At'];
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${FEEDBACK_SHEET_NAME}!A1:F1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [header] }
            });
            console.log(`Sheet tab "${FEEDBACK_SHEET_NAME}" created and header written successfully!`);
        }
        return true;
    } catch (err) {
        console.error('ensureFeedbackSheetExists error:', err.message);
        return false;
    }
}

async function saveFeedbackToGoogleSheet(fb) {
    if (!sheets || !SPREADSHEET_ID) return false;
    try {
        await ensureFeedbackSheetExists();
        const row = [
            fb.id || Date.now(),
            fb.name || '',
            fb.rating || 5,
            fb.comment || '',
            fb.isApproved ? 'YES' : 'NO',
            fb.createdAt ? new Date(fb.createdAt).toISOString() : new Date().toISOString()
        ];
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${FEEDBACK_SHEET_NAME}!A:F`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [row] }
        });
        console.log(`✅ Appended review "${fb.name}" to Google Sheet tab "${FEEDBACK_SHEET_NAME}"`);
        return true;
    } catch (err) {
        console.error('saveFeedbackToGoogleSheet error:', err.message);
        return false;
    }
}

let lastFeedbackSheetSyncTime = 0;
const FEEDBACK_SYNC_TTL_MS = 60000;

async function syncFeedbacksFromSheets(force = false) {
    if (!sheets || !SPREADSHEET_ID) return [];
    if (!force && Date.now() - lastFeedbackSheetSyncTime < FEEDBACK_SYNC_TTL_MS) {
        return loadFeedbacksFromJSON();
    }
    lastFeedbackSheetSyncTime = Date.now();
    try {
        await ensureFeedbackSheetExists();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${FEEDBACK_SHEET_NAME}!A2:F`,
        });
        const rows = response.data.values || [];
        const fetchedFbs = [];
        for (const row of rows) {
            if (!row || (!row[0] && !row[1])) continue;
            const id = row[0] || '';
            const name = row[1] || '';
            const rating = parseInt(row[2], 10) || 5;
            const comment = row[3] || '';
            const isApprovedStr = String(row[4] || '').toUpperCase();
            const isApproved = isApprovedStr === 'YES' || isApprovedStr === 'TRUE' || isApprovedStr === '1';
            const createdAt = row[5] || new Date().toISOString();

            if (!name || !comment) continue;

            const fbObj = { id, name, rating, comment, isApproved, createdAt };
            fetchedFbs.push(fbObj);

            // Upsert into JSON
            const existingFbs = loadFeedbacksFromJSON();
            const exists = existingFbs.find(f => (id && String(f.id) === String(id)) || (f.name === name && f.comment === comment));
            if (!exists) {
                existingFbs.unshift(fbObj);
                saveAllFeedbacksToJSON(existingFbs);
            } else {
                if (exists.isApproved !== isApproved) {
                    exists.isApproved = isApproved;
                    saveAllFeedbacksToJSON(existingFbs);
                }
            }

            // Upsert into SQL DB
            if (isDbConnected && Feedback) {
                await Feedback.findOrCreate({
                    where: { name, comment },
                    defaults: { id: id ? id : undefined, name, rating, comment, isApproved, createdAt: new Date(createdAt) }
                }).then(([instance, created]) => {
                    if (!created && instance.isApproved !== isApproved) {
                        instance.isApproved = isApproved;
                        return instance.save();
                    }
                }).catch(() => {});
            }
        }
        return fetchedFbs;
    } catch (err) {
        console.error('syncFeedbacksFromSheets error:', err.message);
        return [];
    }
}

async function updateFeedbackInGoogleSheet(id, isApproved, isDeleted = false) {
    if (!sheets || !SPREADSHEET_ID) return false;
    try {
        await ensureFeedbackSheetExists();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${FEEDBACK_SHEET_NAME}!A2:F`,
        });
        const rows = response.data.values || [];
        let targetIndex = -1;
        const strId = String(id).trim();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowId = String(row[0] || '').trim();
            const rowName = String(row[1] || '').trim().toLowerCase();
            if (rowId === strId || rowName === strId.toLowerCase()) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
            const rowIndex = targetIndex + 2;
            if (isDeleted) {
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${FEEDBACK_SHEET_NAME}!A${rowIndex}:F${rowIndex}`
                });
                console.log(`Cleared feedback row ${rowIndex} in Google Sheet.`);
            } else {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${FEEDBACK_SHEET_NAME}!E${rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[isApproved ? 'YES' : 'NO']] }
                });
                console.log(`Updated feedback row ${rowIndex} approval to ${isApproved ? 'YES' : 'NO'} in Google Sheet.`);
            }
            return true;
        }
    } catch (err) {
        console.error('updateFeedbackInGoogleSheet error:', err.message);
    }
    return false;
}

let lastDbError = null;

async function initializeApp() {
    if (isInitialized) return;
    
    // Auth with DB
    try {
        if (sequelize && typeof sequelize.authenticate === 'function') {
            await sequelize.authenticate();
            isDbConnected = true;
            lastDbError = null;
            await sequelize.sync({ alter: false });
            isInitialized = true;
            if (!isProdOrVercel) {
                await syncLocalImagesToDB();
                await syncFeedbacksToDB();
            }
        }
    } catch (err) {
        isDbConnected = false;
        lastDbError = err.message;
        console.error('SQL Database Initialization error:', err.message);
    }

    // Auth with Google Sheets
    try {
        let auth;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            try {
                let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
                if (!jsonStr.startsWith('{')) {
                    jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8');
                }
                const credentials = JSON.parse(jsonStr);
                if (credentials.private_key && typeof credentials.private_key === 'string') {
                    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
                }
                auth = new google.auth.GoogleAuth({
                    credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                sheets = google.sheets({ version: 'v4', auth });
                console.log('Google Sheets: Service Account (from env) initialized.');
            } catch (e) {
                console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
            }
        } else if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            auth = new google.auth.GoogleAuth({
                keyFile: SERVICE_ACCOUNT_FILE,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            sheets = google.sheets({ version: 'v4', auth });
            console.log('Google Sheets: Service Account file initialized.');
        }

        if (sheets && SPREADSHEET_ID) {
            await syncSheetsToSQL();
        }
    } catch (err) {
        console.error('Google Sheets Initialization error:', err.message);
    }

    isInitialized = true;
}


async function syncSheetsToSQL() {
    try {
        if (!sheets || !SPREADSHEET_ID) return { success: false, count: 0, message: 'Google Sheets API not initialized' };
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:L`, 
        });
        const rows = response.data.values;
        let syncedCount = 0;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                if (!row || !row[0] || !row[3]) continue;
                const phone = String(row[3]).trim();
                const name = String(row[0]).trim();
                if (!phone || !name) continue;

                const existingJsonDonors = loadDonorsFromJSON();
                const existingDonor = existingJsonDonors.find(d => String(d.phoneNumber) === phone && String(d.fullName).toLowerCase() === name.toLowerCase());

                const donorObj = {
                    fullName: name,
                    dateOfBirth: row[1] || null,
                    gender: row[2] || 'Not specified',
                    weight: row[10] || '',
                    phoneNumber: phone,
                    bloodGroup: row[4] || 'O+',
                    state: row[5] || '',
                    district: row[6] || '',
                    mandal: row[7] || '',
                    village: row[8] || '',
                    pincode: row[11] || '',
                    registeredAt: row[9] ? new Date(row[9]) : new Date(),
                    isVerified: existingDonor ? !!existingDonor.isVerified : false
                };

                saveDonorToJSON(donorObj);
                syncedCount++;

                if (Donor && isDbConnected) {
                    await Donor.findOrCreate({
                        where: { phoneNumber: phone, fullName: name },
                        defaults: donorObj
                    }).catch(e => console.error('findOrCreate row error:', e.message));
                }
            }
            console.log(`✅ Synced ${syncedCount} records from Google Sheets.`);
            await syncFeedbacksFromSheets().catch(e => console.error('Feedback sheet sync error:', e.message));
            return { success: true, count: syncedCount, totalRows: rows.length };
        }
        await syncFeedbacksFromSheets().catch(e => console.error('Feedback sheet sync error:', e.message));
        return { success: true, count: 0, totalRows: 0 };
    } catch (error) {
        console.error('Sync Error:', error.message);
        return { success: false, count: 0, error: error.message };
    }
}

// Google Sheets Batching System
let donorBatch = [];
let batchTimeout = null;

async function processBatch() {
    if (donorBatch.length === 0) return;
    
    const batchToProcess = [...donorBatch];
    donorBatch = []; // Clear queue

    try {
        if (!sheets || !SPREADSHEET_ID) return;
        
        const values = batchToProcess.map(donor => [
            donor.fullName,
            donor.dateOfBirth || '',
            donor.gender || '',
            donor.phoneNumber || '',
            donor.bloodGroup || '',
            donor.state || '',
            donor.district || '',
            donor.mandal || '',
            donor.village || '',
            new Date(donor.registeredAt || new Date()).toLocaleString(),
            donor.weight || '',
            donor.pincode || ''
        ]);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:L`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values }
        });
        console.log(`✅ Synced batch of ${values.length} donors to Google Sheets.`);
    } catch (error) {
        console.error('Google Sheets Batch Append Error:', error.message);
        donorBatch.unshift(...batchToProcess);
    }
}

async function appendDonorToGoogleSheet(donor) {
    donorBatch.push(donor);
    // Process batch immediately to ensure instant visibility in Google Sheets
    await processBatch();
}



// Storage for "Our Work" Gallery
const isProdOrVercel = !!(process.env.VERCEL || process.env.NODE_ENV === 'production');
const UPLOAD_DIR = path.join(isProdOrVercel ? '/tmp' : path.join(__dirname, '..', 'frontend'), 'assets', GALLERY_PATH);
if (!fs.existsSync(UPLOAD_DIR)) {
    try {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (e) {
        console.error('Failed to create upload dir:', e.message);
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.'));
        }
    }
});

// Verification Middleware
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token) return res.status(403).json({ success: false, message: 'No token' });
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        if (verified.role === 'admin') {
            req.user = verified;
            next();
        } else {
            res.status(403).json({ success: false, message: 'Not admin' });
        }
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

const sharedState = { 
    currentAlert: null,
    emergencyRequests: []
};

// API Endpoints
app.get(['/health', '/api/health'], async (req, res) => {
    if (!isInitialized) {
        try { await initializeApp(); } catch (e) {}
    }
    if (sequelize && typeof sequelize.authenticate === 'function') {
        try {
            await sequelize.authenticate();
            isDbConnected = true;
            lastDbError = null;
        } catch (e) {
            isDbConnected = false;
            lastDbError = e.message;
        }
    }
    return res.json({
        status: 'ok',
        initialized: isInitialized,
        database: isDbConnected ? dbDialect : (dbDialect === 'postgresql' ? 'postgresql (disconnected)' : 'sqlite'),
        dbConnected: isDbConnected,
        dbError: lastDbError,
        hasSheets: !!sheets
    });
});

async function findDuplicateDonor(fullName, phoneNumber) {
    if (!fullName || !phoneNumber) return null;
    const cleanName = String(fullName).trim().toLowerCase();
    const cleanPhone = String(phoneNumber).trim();
    if (!cleanName || !cleanPhone) return null;

    if (isDbConnected && Donor) {
        try {
            const matches = await Donor.findAll({
                where: { phoneNumber: cleanPhone }
            });
            const found = matches.find(d => String(d.fullName || '').trim().toLowerCase() === cleanName);
            if (found) return found;
        } catch (e) {
            console.error('Error searching SQL DB for duplicate donor:', e.message);
        }
    }

    const jsonDonors = loadDonorsFromJSON();
    const foundJson = jsonDonors.find(d => 
        String(d.phoneNumber || '').trim() === cleanPhone &&
        String(d.fullName || '').trim().toLowerCase() === cleanName
    );
    if (foundJson) return foundJson;

    if (Array.isArray(fallbackDonorsStore)) {
        const foundFallback = fallbackDonorsStore.find(d => 
            String(d.phoneNumber || '').trim() === cleanPhone &&
            String(d.fullName || '').trim().toLowerCase() === cleanName
        );
        if (foundFallback) return foundFallback;
    }

    return null;
}

app.get('/api/v1/donors/check-duplicate', async (req, res) => {
    try {
        const { fullName, phoneNumber } = req.query;
        if (!fullName || !phoneNumber) {
            return res.json({ success: true, isDuplicate: false });
        }
        const existing = await findDuplicateDonor(fullName, phoneNumber);
        if (existing) {
            return res.json({ 
                success: true, 
                isDuplicate: true, 
                message: 'This donor is already registered' 
            });
        }
        return res.json({ success: true, isDuplicate: false });
    } catch (err) {
        console.error('Error checking duplicate donor:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

const donorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 donor registrations per windowMs
    message: { success: false, message: 'Too many registrations from this IP, please try again later.' }
});

app.post('/api/v1/donors', donorLimiter, async (req, res) => {
    try {
        const { fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup, address } = req.body;
        if (!fullName || !phoneNumber) {
            return res.status(400).json({ success: false, message: 'Full name and phone number are required.' });
        }

        if (dateOfBirth) {
            let birthDate;
            if (dateOfBirth.includes('-')) {
                const parts = dateOfBirth.split('-');
                if (parts[0].length === 4) birthDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                else if (parts[2].length === 4) birthDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            } else if (dateOfBirth.includes('/')) {
                const parts = dateOfBirth.split('/');
                if (parts[0].length === 4) birthDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                else if (parts[2].length === 4) birthDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            } else {
                birthDate = new Date(dateOfBirth);
            }
            if (birthDate && !isNaN(birthDate.getTime())) {
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
                if (age < 18) {
                    return res.status(400).json({ success: false, message: 'Under 18 years age donor are not eligible to donate the blood' });
                }
            }
        }

        const duplicate = await findDuplicateDonor(fullName, phoneNumber);
        if (duplicate) {
            return res.status(400).json({
                success: false,
                duplicate: true,
                message: 'This donor is already registered'
            });
        }

        let newDonor;
        try {
            newDonor = await Donor.create({
                fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup,
                state: address?.state || '',
                district: address?.district || '',
                mandal: address?.mandal || '',
                village: address?.village || '',
                pincode: address?.pincode || ''
            });
        } catch (dbErr) {
            console.error('Primary DB save error, using fallback memory store:', dbErr.message);
            newDonor = {
                id: Date.now(),
                fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup,
                state: address?.state || '',
                district: address?.district || '',
                mandal: address?.mandal || '',
                village: address?.village || '',
                pincode: address?.pincode || '',
                registeredAt: new Date()
            };
            fallbackDonorsStore.unshift(newDonor);
        }
        saveDonorToJSON(newDonor);
        res.status(201).json({ success: true, donor: newDonor });
        // Run Google Sheets sync asynchronously in background without delaying HTTP response
        appendDonorToGoogleSheet(newDonor).catch(e => console.error('Sheet append error:', e.message));
    } catch (err) {
        console.error('Registration handler catch:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

async function getTotalDonorsCount() {
    let count = 0;
    if (isDbConnected && Donor) {
        try {
            count = await Donor.count();
        } catch (e) {}
    }
    if (!count) {
        try {
            const jsonDonors = loadDonorsFromJSON();
            count = jsonDonors.length || (fallbackDonorsStore ? fallbackDonorsStore.length : 0);
        } catch (e) {}
    }
    return count;
}

async function getTotalDonationImagesCount() {
    try {
        let filesSet = new Set();

        if (isDbConnected && GalleryImage) {
            try {
                const dbRecords = await GalleryImage.findAll({ attributes: ['filename'] });
                dbRecords.forEach(r => filesSet.add(r.filename));
            } catch (e) {}
        }

        let repoDir = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH);
        let tmpDir = UPLOAD_DIR;
        if (fs.existsSync(repoDir)) {
            try {
                fs.readdirSync(repoDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).forEach(f => filesSet.add(f));
            } catch (e) {}
        }
        if (fs.existsSync(tmpDir) && tmpDir !== repoDir) {
            try {
                fs.readdirSync(tmpDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).forEach(f => filesSet.add(f));
            } catch (e) {}
        }

        if (filesSet.size > 0) return filesSet.size;
    } catch (e) {}

    return await getTotalDonorsCount();
}

app.get('/api/v1/donations/count', async (req, res) => {
    try {
        const count = await getTotalDonationImagesCount();
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

app.get('/api/v1/public/gallery/image/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        let imageRecord = null;
        if (isDbConnected && GalleryImage) {
            try {
                imageRecord = await GalleryImage.findOne({ where: { filename } });
            } catch (e) {}
        }

        if (imageRecord && imageRecord.imageData) {
            const matches = imageRecord.imageData.match(/^data:(image\/\w+);base64,(.+)$/);
            if (matches) {
                const mimeType = matches[1];
                const buffer = Buffer.from(matches[2], 'base64');
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                return res.send(buffer);
            }
        }

        // Fallback to local filesystem
        let filePath = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH, filename);
        if (!fs.existsSync(filePath)) {
            filePath = path.join(UPLOAD_DIR, filename);
        }
        if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
        }

        res.status(404).json({ success: false, message: 'Image not found' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/gallery', async (req, res) => {
    try {
        let filesSet = new Set();

        // 1. Fetch from Database
        if (isDbConnected && GalleryImage) {
            try {
                const dbRecords = await GalleryImage.findAll({ attributes: ['filename'] });
                dbRecords.forEach(r => filesSet.add(r.filename));
            } catch (e) {}
        }

        // 2. Merge with local files
        let repoDir = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH);
        let tmpDir = UPLOAD_DIR;
        if (fs.existsSync(repoDir)) {
            try {
                fs.readdirSync(repoDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).forEach(f => filesSet.add(f));
            } catch (e) {}
        }
        if (fs.existsSync(tmpDir) && tmpDir !== repoDir) {
            try {
                fs.readdirSync(tmpDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).forEach(f => filesSet.add(f));
            } catch (e) {}
        }
        let files = Array.from(filesSet);
        
        // Separate admin uploads (timestamp prefix) from manual files
        const isAdminUpload = (f) => /^\d{13,}-/.test(f);
        const adminFiles = files.filter(isAdminUpload);
        const manualFiles = files.filter(f => !isAdminUpload(f));
        
        // Sort admin files newest first (descending)
        adminFiles.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        // Sort manual files naturally (1.jpg < 2.jpg)
        manualFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        
        files = [...adminFiles, ...manualFiles];
        res.json({ success: true, images: files.map(img => `api/v1/public/gallery/image/${encodeURIComponent(img)}`) });
    } catch (err) {
        res.json({ success: false, images: [] });
    }
});

function getGoogleSheetInfo() {
    const spId = SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '1E2g-qu5tpzv5npT7h0Q7_wFVhIr1AANehi_UdKH4wLw';
    return {
        spreadsheetId: spId,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${spId}/edit`,
        serviceAccountEmail: 'mb-bloods-sheet@mahesh-babu-bloods.iam.gserviceaccount.com',
        isConnected: !!sheets,
        sheetName: SHEET_NAME || 'Sheet1'
    };
}

// Load Admin Backend Routes
require('./adminRoutes')(app, {
    JWT_SECRET,
    WHITELISTED_NUMBERS,
    adminOtps,
    upload,
    GALLERY_PATH,
    Donor,
    Feedback,
    GalleryImage,
    sharedState,
    syncSheetsToSQL,
    loadDonorsFromJSON,
    fallbackDonorsStore,
    getTotalDonationImagesCount,
    getGoogleSheetInfo,
    loadFeedbacksFromJSON,
    toggleDonorVerificationInJSON,
    deleteDonorFromJSON,
    toggleFeedbackApprovalInJSON,
    deleteFeedbackFromJSON,
    saveFeedbackToGoogleSheet,
    updateFeedbackInGoogleSheet,
    syncFeedbacksFromSheets
});

const feedbackLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 feedback submissions per window
    message: { success: false, message: 'Too many feedback submissions, please try again later.' }
});

app.post('/api/v1/feedbacks', feedbackLimiter, async (req, res) => {
    try {
        const { name, rating, comment } = req.body;
        if (!name || rating === undefined || !comment) {
            return res.status(400).json({ success: false, message: 'Name, rating, and comment are required.' });
        }
        const parsedRating = parseInt(rating, 10);
        if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5.' });
        }
        let newFeedback;
        try {
            newFeedback = await Feedback.create({ name, rating: parsedRating, comment });
        } catch (e) {
            newFeedback = { id: Date.now(), name, rating: parsedRating, comment, isApproved: false, createdAt: new Date() };
        }
        const fbObj = newFeedback.toJSON ? newFeedback.toJSON() : newFeedback;
        saveFeedbackToJSON(fbObj);

        // Save to Google Sheet tab "Feedbacks"
        saveFeedbackToGoogleSheet(fbObj).catch(e => console.error('Sheet feedback save error:', e.message));

        res.status(201).json({ success: true, feedback: newFeedback });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/feedbacks', async (req, res) => {
    try {
        // Attempt quick sync from Google Sheet if connected
        await syncFeedbacksFromSheets().catch(() => {});

        let dbFbs = [];
        if (isDbConnected && Feedback) {
            try {
                dbFbs = await Feedback.findAll({
                    where: { isApproved: true },
                    order: [['createdAt', 'DESC']],
                    limit: 50
                });
            } catch (e) {}
        }
        let jsonFbs = loadFeedbacksFromJSON().filter(f => f.isApproved);
        const map = new Map();
        dbFbs.forEach(f => {
            const item = f.toJSON ? f.toJSON() : f;
            map.set(`${item.name}_${item.comment}`, item);
        });
        jsonFbs.forEach(f => {
            const key = `${f.name}_${f.comment}`;
            if (!map.has(key)) map.set(key, f);
        });
        const merged = Array.from(map.values());
        merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.json({ success: true, feedbacks: merged });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/alert', (req, res) => res.json({ success: true, alert: sharedState.currentAlert?.isActive ? sharedState.currentAlert : null }));

app.post('/api/v1/public/emergency-request', (req, res) => {
    try {
        const { patientName, bloodGroup, phoneNumber, hospital, city, urgency, notes } = req.body || {};
        if (!phoneNumber || !bloodGroup) {
            return res.status(400).json({ success: false, message: 'Phone number and blood group are required.' });
        }
        if (!sharedState.emergencyRequests) sharedState.emergencyRequests = [];

        const newRequest = {
            id: 'EMG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            patientName: patientName || 'Emergency Patient',
            bloodGroup: bloodGroup || 'Emergency',
            phoneNumber: phoneNumber || '',
            hospital: hospital || '',
            city: city || '',
            urgency: urgency || 'Immediate',
            notes: notes || 'Blood request from website / WhatsApp',
            createdAt: new Date().toISOString(),
            status: 'pending'
        };
        sharedState.emergencyRequests.unshift(newRequest);
        if (sharedState.emergencyRequests.length > 50) {
            sharedState.emergencyRequests = sharedState.emergencyRequests.slice(0, 50);
        }

        res.status(201).json({ success: true, request: newRequest });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// Start server if not running in a serverless environment (like Vercel)
const isServerlessEnv = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isServerlessEnv) {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    initializeApp().catch(err => console.error('Initialization error:', err.message));
}

module.exports = app;
