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
let sqlite3Driver = null;

try { pgDriver = require('pg'); } catch (e) {}
try { require('pg-hstore'); } catch (e) {}
try { sqlite3Driver = require('sqlite3'); } catch (e) {}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
const GALLERY_PATH = process.env.GALLERY_FOLDER || 'our work';

// Normalize Vercel Serverless Function rewrites (e.g. /api/index.js/v1/... -> /api/v1/...)
app.use((req, res, next) => {
    if (req.url && req.url.startsWith('/api/index.js')) {
        req.url = req.url.replace('/api/index.js', '/api') || '/';
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
        
        // Check allowed origins, vercel domains, or localhost
        const isAllowed = allowedOrigins.includes(origin) || 
                          /^https:\/\/.*\.vercel\.app$/.test(origin) || 
                          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

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

function initSequelize() {
    if (process.env.DATABASE_URL) {
        console.log('Using PostgreSQL database connection');
        try {
            const options = {
                dialect: 'postgres',
                dialectOptions: {
                    ssl: { require: true, rejectUnauthorized: false }
                },
                logging: false
            };
            if (pgDriver) options.dialectModule = pgDriver;
            return new Sequelize(process.env.DATABASE_URL, options);
        } catch (err) {
            console.error('Postgres Sequelize Initialization Error:', err.message);
        }
    }

    console.log('Using SQLite database connection');
    const dbPath = process.env.NODE_ENV === 'production' 
        ? path.join('/tmp', 'database.sqlite') 
        : path.join(__dirname, 'database.sqlite');

    const sqliteOptions = {
        dialect: 'sqlite',
        storage: dbPath,
        logging: false
    };
    if (sqlite3Driver) sqliteOptions.dialectModule = sqlite3Driver;

    try {
        return new Sequelize(sqliteOptions);
    } catch (err) {
        console.error('SQLite Sequelize Initialization Error:', err.message);
        try {
            return new Sequelize('sqlite::memory:', { logging: false });
        } catch (e2) {
            console.error('Fallback Sequelize Initialization Error:', e2.message);
            return null;
        }
    }
}

sequelize = initSequelize();

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

// Admin Config
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';
const ADMIN_USERS = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS }
].filter(u => u.username && u.password);

// Whitelisted WhatsApp Numbers for Admin Login
const WHITELISTED_NUMBERS = [
    process.env.ADMIN_WHATSAPP_1 || '919876543210', // Replace with real number
    process.env.ADMIN_WHATSAPP_2 || '919012345678'  // Replace with real number
];
let adminOtps = new Map(); // Temporary OTP storage

// Serve static files (HTML, CSS, JS, Assets)
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..', 'admin-frontend')));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Google Sheets Config
const SERVICE_ACCOUNT_FILE = path.join(__dirname, '..', 'service-account.json');
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

let sheets;
let isInitialized = false;

async function initializeApp() {
    if (isInitialized) return;
    
    // Auth with DB
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: process.env.DATABASE_URL ? true : false });
        console.log('SQL Database initialized successfully.');
    } catch (err) {
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
        if (!sheets || !SPREADSHEET_ID) return;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:J`, 
        });
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                await Donor.findOrCreate({
                    where: { phoneNumber: row[3], fullName: row[0] },
                    defaults: {
                        dateOfBirth: row[1],
                        gender: row[2] || 'Not specified',
                        weight: row[10] || '', // Assuming weight is in the 11th column (K)
                        bloodGroup: row[4],
                        state: row[5],
                        district: row[6],
                        mandal: row[7],
                        village: row[8],
                        pincode: row[11] || '', // Assuming pincode is in the 12th column (L)
                        registeredAt: row[9] ? new Date(row[9]) : new Date(),
                        isVerified: false
                    }
                });
            }
            console.log(`✅ Synced ${rows.length} records.`);
        }
    } catch (error) {
        console.error('Sync Error:', error.message);
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
            donor.dateOfBirth,
            donor.gender,
            donor.phoneNumber,
            donor.bloodGroup,
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
        // Put records back in queue if the API failed (e.g., rate limit)
        donorBatch.unshift(...batchToProcess);
    }
}

async function appendDonorToGoogleSheet(donor) {
    donorBatch.push(donor);
    
    // On Vercel or serverless production, process immediately because background timeouts are unreliable
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        await processBatch();
        return;
    }
    
    // Auto-process batch every 5 minutes
    if (!batchTimeout) {
        batchTimeout = setTimeout(() => {
            processBatch();
            batchTimeout = null;
        }, 5 * 60 * 1000);
    }
    
    // Process immediately if batch reaches 50 to avoid request body size limits
    if (donorBatch.length >= 50) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
        processBatch();
    }
}



// Storage for "Our Work" Gallery
const UPLOAD_DIR = path.join(process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, '..', 'frontend'), 'assets', GALLERY_PATH);
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

const sharedState = { currentAlert: null };

// API Endpoints
app.get(['/health', '/api/health'], (req, res) => res.json({
    status: 'ok',
    initialized: isInitialized,
    database: process.env.DATABASE_URL ? 'postgresql' : 'sqlite',
    hasSheets: !!sheets
}));

const donorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 donor registrations per windowMs
    message: { success: false, message: 'Too many registrations from this IP, please try again later.' }
});

app.post('/api/v1/donors', donorLimiter, async (req, res) => {
    try {
        const { fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup, address } = req.body;
        const newDonor = await Donor.create({
            fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup,
            state: address?.state || '',
            district: address?.district || '',
            mandal: address?.mandal || '',
            village: address?.village || '',
            pincode: address?.pincode || ''
        });
        appendDonorToGoogleSheet(newDonor).catch(e => console.error('Sheet append error:', e.message));
        res.status(201).json({ success: true, donor: newDonor });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/donations/count', async (req, res) => {
    try {
        const count = await Donor.count();
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

app.get('/api/v1/public/gallery', (req, res) => {
    try {
        let repoDir = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH);
        let tmpDir = UPLOAD_DIR;
        let filesSet = new Set();
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
        res.json({ success: true, images: files.map(img => `assets/${GALLERY_PATH}/${img}`) });
    } catch (err) {
        res.json({ success: false, images: [] });
    }
});

// Load Admin Backend Routes
require('./adminRoutes')(app, {
    JWT_SECRET,
    WHITELISTED_NUMBERS,
    adminOtps,
    upload,
    GALLERY_PATH,
    Donor,
    Feedback,
    sharedState
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
        const newFeedback = await Feedback.create({ name, rating: parsedRating, comment });
        res.status(201).json({ success: true, feedback: newFeedback });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/feedbacks', async (req, res) => {
    try {
        const feedbacks = await Feedback.findAll({
            where: { isApproved: true },
            order: [['createdAt', 'DESC']],
            limit: 20
        });
        res.json({ success: true, feedbacks });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/alert', (req, res) => res.json({ success: true, alert: sharedState.currentAlert?.isActive ? sharedState.currentAlert : null }));


// Start server if not running in a serverless environment (like Vercel)
if (process.env.NODE_ENV !== 'production' || process.env.RENDER || !process.env.VERCEL) {
    initializeApp().then(() => {
        app.listen(PORT, () => console.log(`Server on ${PORT}`));
    });
}

module.exports = app;
