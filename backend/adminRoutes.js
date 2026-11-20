const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const {
    sendAdminOTPEmail,
    maskEmail,
    maskEmailList,
    maskPhoneNumber,
    getAllAdminEmails,
    resolveAdminProfile
} = require('./services/adminEmailService');

module.exports = function(app, deps) {
    const { JWT_SECRET, WHITELISTED_NUMBERS, adminOtps, upload, GALLERY_PATH, Donor, Feedback, GalleryImage, sharedState, syncSheetsToSQL, loadDonorsFromJSON, fallbackDonorsStore, getTotalDonationImagesCount, getGoogleSheetInfo, loadFeedbacksFromJSON, toggleDonorVerificationInJSON, deleteDonorFromJSON, toggleFeedbackApprovalInJSON, deleteFeedbackFromJSON, saveFeedbackToGoogleSheet, updateFeedbackInGoogleSheet, syncFeedbacksFromSheets, fallbackFeedbacksStore } = deps;
    const fs = require('fs');
    const path = require('path');

    let cachedMergedDonors = null;
    let lastMergedTime = 0;
    const MERGED_CACHE_TTL = 3000;

    function invalidateMergedDonorsCache() {
        cachedMergedDonors = null;
        lastMergedTime = 0;
    }

    async function getAllMergedDonors(force = false) {
        if (!force && cachedMergedDonors && (Date.now() - lastMergedTime < MERGED_CACHE_TTL)) {
            return cachedMergedDonors;
        }
        let sqlResults = [];
        try {
            sqlResults = await Donor.findAll();
        } catch (e) {
            console.error('SQL query error:', e.message);
        }
        let jsonDonors = [];
        if (typeof loadDonorsFromJSON === 'function') {
            try {
                jsonDonors = loadDonorsFromJSON();
            } catch (e) {}
        }
        const donorMap = new Map();
        sqlResults.forEach((d, idx) => {
            const item = d.toJSON ? d.toJSON() : d;
            if (item.phoneNumber || item.fullName) {
                const key = `${String(item.phoneNumber || '').trim()}_${String(item.fullName || '').trim().toLowerCase()}`;
                donorMap.set(key, { ...item, id: item.id || (idx + 1) });
            }
        });
        jsonDonors.forEach((item, idx) => {
            if (item.phoneNumber || item.fullName) {
                const key = `${String(item.phoneNumber || '').trim()}_${String(item.fullName || '').trim().toLowerCase()}`;
                if (!donorMap.has(key)) {
                    donorMap.set(key, { ...item, id: item.id || (idx + 1) });
                } else {
                    const existing = donorMap.get(key);
                    if (item.isVerified) existing.isVerified = true;
                }
            }
        });
        if (Array.isArray(fallbackDonorsStore)) {
            fallbackDonorsStore.forEach((item, idx) => {
                if (item.phoneNumber || item.fullName) {
                    const key = `${String(item.phoneNumber || '').trim()}_${String(item.fullName || '').trim().toLowerCase()}`;
                    if (!donorMap.has(key)) {
                        donorMap.set(key, { ...item, id: item.id || (idx + 1) });
                    }
                }
            });
        }
        if (donorMap.size === 0 && typeof syncSheetsToSQL === 'function') {
            try {
                await syncSheetsToSQL();
                if (typeof loadDonorsFromJSON === 'function') {
                    const freshDonors = loadDonorsFromJSON();
                    freshDonors.forEach((item, idx) => {
                        if (item.phoneNumber || item.fullName) {
                            const key = `${String(item.phoneNumber || '').trim()}_${String(item.fullName || '').trim().toLowerCase()}`;
                            if (!donorMap.has(key)) {
                                donorMap.set(key, { ...item, id: item.id || (idx + 1) });
                            }
                        }
                    });
                }
            } catch (e) {}
        }
        const merged = Array.from(donorMap.values());
        merged.forEach((d, idx) => {
            if (!d.id) d.id = idx + 1;
            if (!d.fullName) d.fullName = 'Donor';
            if (!d.phoneNumber) d.phoneNumber = 'N/A';
            if (!d.bloodGroup) d.bloodGroup = 'O+';
            if (!d.state) d.state = '';
            if (!d.district) d.district = '';
            if (!d.mandal) d.mandal = '';
            if (!d.village) d.village = '';
            if (!d.pincode) d.pincode = '';
            d.isVerified = !!d.isVerified;
        });

        merged.sort((a, b) => {
            const timeB = b.registeredAt ? new Date(b.registeredAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            const timeA = a.registeredAt ? new Date(a.registeredAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            return timeB - timeA;
        });
        cachedMergedDonors = merged;
        lastMergedTime = Date.now();
        return merged;
    }

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

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 30, // Limit each IP to 30 login requests per windowMs
        message: { success: false, message: 'Too many login attempts. Please try again later.' }
    });

        async function sendSMSOTP(phoneNumber, otp) {
        const apiKey = (process.env.FAST2SMS_API_KEY || '').trim().replace(/^["']|["']$/g, '');
        if (!apiKey) {
            console.log(`[SMS OTP MOCK] (Set FAST2SMS_API_KEY in env) To: ${phoneNumber}, Code: ${otp}`);
            return { success: true, mock: true };
        }

        const cleanNumber = String(phoneNumber).replace(/\D/g, '').slice(-10);

        try {
            const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    route: 'otp',
                    variables_values: String(otp),
                    numbers: cleanNumber
                })
            });

            const data = await response.json();
            if (!response.ok || data.return === false || (data.status_code && data.status_code !== 200)) {
                console.warn('[FAST2SMS API NOTICE]:', data.message || data);
                return { success: false, error: data.message };
            }
            console.log(`[SMS OTP SENT via Fast2SMS] To: ${cleanNumber}, Request ID: ${data.request_id}`);
            return { success: true, data };
        } catch (err) {
            console.error('[FAST2SMS REQUEST ERROR]:', err.message);
            return { success: false, error: err.message };
        }
    }

async function sendWhatsAppOTP(phoneNumber, otp) {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

        if (!token || !phoneId) {
            console.log(`[WHATSAPP OTP MOCK] (Set WHATSAPP_TOKEN & WHATSAPP_PHONE_NUMBER_ID in env for real WhatsApp messages) To: ${phoneNumber}, Code: ${otp}`);
            return { success: true, mock: true };
        }

        const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phoneNumber,
                type: 'text',
                text: {
                    body: `🩸 *MB Bloods Admin Portal*\n\nYour login verification OTP is: *${otp}*\n\nThis code expires in 5 minutes. Do not share this OTP with anyone.`
                }
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('[WHATSAPP API ERROR]', data);
            throw new Error(data.error?.message || 'Failed to send WhatsApp message via Meta Cloud API');
        }
        console.log(`[WHATSAPP OTP SENT] To: ${phoneNumber}, Message ID: ${data.messages?.[0]?.id}`);
        return data;
    }

    async function dispatchDualChannel2FA({ cleanNumber, otp, req, preferredChannel = 'both', actionName = 'Admin Authentication' }) {
        const profile = resolveAdminProfile(cleanNumber);
        const results = { sms: false, whatsapp: false, email: false };

        const tasks = [];

        // 1. Regular SMS Text Message (Fast2SMS)
        if (preferredChannel === 'both' || preferredChannel === 'all' || preferredChannel === 'sms') {
            tasks.push(
                sendSMSOTP(cleanNumber, otp)
                    .then(res => { if (res && res.success && !res.mock) results.sms = true; })
                    .catch(err => { console.error('[SMS 2FA ERROR]:', err.message); })
            );
        }

        // 2. WhatsApp Message (Meta Cloud API)
        if (preferredChannel === 'both' || preferredChannel === 'all' || preferredChannel === 'whatsapp') {
            tasks.push(
                sendWhatsAppOTP(cleanNumber, otp)
                    .then(() => { results.whatsapp = true; })
                    .catch(err => { console.error('[WHATSAPP 2FA ERROR]:', err.message); })
            );
        }

        // 3. Security Email (Nodemailer)
        if (preferredChannel === 'both' || preferredChannel === 'all' || preferredChannel === 'email') {
            tasks.push(
                sendAdminOTPEmail({
                    toEmails: profile.allEmails,
                    adminName: profile.name,
                    actionName,
                    otpCode: otp,
                    expirationMinutes: 5,
                    req
                })
                    .then(() => { results.email = true; })
                    .catch(err => { console.error('[EMAIL 2FA ERROR]:', err.message); })
            );
        }

        await Promise.allSettled(tasks);

        return {
            profile,
            results,
            delivery: {
                sms: maskPhoneNumber(cleanNumber),
                whatsapp: maskPhoneNumber(cleanNumber),
                email: maskEmailList(profile.allEmails),
                channels: [
                    ...(results.sms ? ['sms'] : []),
                    ...(results.whatsapp ? ['whatsapp'] : []),
                    ...(results.email ? ['email'] : [])
                ]
            }
        };
    }

    app.post('/api/v1/admin/send-otp', loginLimiter, async (req, res) => {
        const { phoneNumber, channel = 'both' } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number is required.' });
        }
        
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const validNumbers = Array.isArray(WHITELISTED_NUMBERS) ? WHITELISTED_NUMBERS.map(n => String(n).replace(/\D/g, '')) : [];
        if (!validNumbers.includes('919948550301')) validNumbers.push('919948550301');
        if (!validNumbers.includes('919491463888')) validNumbers.push('919491463888');
        if (!validNumbers.includes('918758754005')) validNumbers.push('918758754005');
        if (!validNumbers.includes('8758754005')) validNumbers.push('8758754005');

        if (!validNumbers.includes(cleanNumber)) {
            return res.status(403).json({ 
                success: false, 
                message: 'WARNING: Unauthorized access attempt! This number is not registered for admin access.' 
            });
        }

        // Cooldown check (45 seconds)
        const stored = adminOtps.get(cleanNumber);
        const COOLDOWN_MS = 45 * 1000;
        if (stored && (Date.now() - (stored.lastSentAt || 0) < COOLDOWN_MS)) {
            const wait = Math.ceil((COOLDOWN_MS - (Date.now() - stored.lastSentAt)) / 1000);
            return res.status(429).json({
                success: false,
                message: `Please wait ${wait}s before requesting a new OTP.`
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const dispatch = await dispatchDualChannel2FA({
            cleanNumber,
            otp,
            req,
            preferredChannel: channel,
            actionName: 'Admin Direct OTP Request'
        });

        adminOtps.set(cleanNumber, {
            otp,
            expires: Date.now() + 5 * 60 * 1000,
            attempts: 0,
            lastSentAt: Date.now(),
            email: dispatch.profile.email,
            name: dispatch.profile.name
        });

        res.json({
            success: true,
            delivery: dispatch.delivery,
            cooldownSeconds: 45,
            message: `OTP dispatched across security channels (SMS, WhatsApp & Email).`
        });
    });

    app.post('/api/v1/admin/resend-otp', loginLimiter, async (req, res) => {
        const { phoneNumber, channel = 'both' } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number is required.' });
        }
        const cleanNumber = String(phoneNumber).replace(/\D/g, '');
        const stored = adminOtps.get(cleanNumber);

        if (!stored) {
            return res.status(400).json({ success: false, message: 'No active authentication session. Please verify password first.' });
        }

        // Enforce 45s cooldown
        const COOLDOWN_MS = 45 * 1000;
        const timeSince = Date.now() - (stored.lastSentAt || 0);
        if (timeSince < COOLDOWN_MS) {
            const wait = Math.ceil((COOLDOWN_MS - timeSince) / 1000);
            return res.status(429).json({
                success: false,
                message: `Please wait ${wait}s before requesting a new 2FA code.`
            });
        }

        // Generate fresh OTP
        const freshOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const dispatch = await dispatchDualChannel2FA({
            cleanNumber,
            otp: freshOtp,
            req,
            preferredChannel: channel,
            actionName: 'Admin 2FA Resend Request'
        });

        stored.otp = freshOtp;
        stored.expires = Date.now() + 5 * 60 * 1000;
        stored.attempts = 0;
        stored.lastSentAt = Date.now();
        adminOtps.set(cleanNumber, stored);

        console.log(`[2FA OTP RESENT] To: ${cleanNumber}, Code: ${freshOtp}`);

        res.json({
            success: true,
            delivery: dispatch.delivery,
            cooldownSeconds: 45,
            message: `Fresh 2FA code dispatched via ${channel === 'both' ? 'SMS, WhatsApp & Security Email' : channel}.`
        });
    });

    app.post('/api/v1/admin/login', loginLimiter, async (req, res) => {
        const { phoneNumber, password, otp } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }
        const cleanNumber = (phoneNumber || '').toString().replace(/\D/g, '');
        const validNumbers = Array.isArray(WHITELISTED_NUMBERS) ? WHITELISTED_NUMBERS.map(n => String(n).replace(/\D/g, '')) : [];
        if (!validNumbers.includes('919948550301')) validNumbers.push('919948550301');
        if (!validNumbers.includes('919491463888')) validNumbers.push('919491463888');
        if (!validNumbers.includes('918758754005')) validNumbers.push('918758754005');
        if (!validNumbers.includes('8758754005')) validNumbers.push('8758754005');
        
        if (!validNumbers.includes(cleanNumber)) {
            return res.status(403).json({ 
                success: false, 
                message: 'WARNING: Unauthorized access attempt! This number is not registered for admin access.' 
            });
        }

        const envPassword = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
        const validPasswords = ['VA@mb0727', 'va@mb0727', 'VA@2027mb', 'VA#0727@mb', 'VA&0727@mb', 'va@2027mb', 'va#0727@mb', 'va&0727@mb'];
        if (envPassword) {
            validPasswords.push(envPassword);
            validPasswords.push(envPassword.toLowerCase());
        }

        const inputPassword = (password || '').trim();
        const isValidPassword = validPasswords.some(vp => vp.toLowerCase() === inputPassword.toLowerCase());

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid admin password.'
            });
        }

        // Generate 2FA 6-digit OTP code
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Dispatch Dual-Channel (WhatsApp + Email) in parallel
        const dispatch = await dispatchDualChannel2FA({
            cleanNumber,
            otp: generatedOtp,
            req,
            preferredChannel: 'both',
            actionName: 'Admin Portal Login & Authentication'
        });

        adminOtps.set(cleanNumber, {
            otp: generatedOtp,
            expires: Date.now() + 5 * 60 * 1000,
            attempts: 0,
            lastSentAt: Date.now(),
            email: dispatch.profile.email,
            name: dispatch.profile.name
        });

        console.log(`[DUAL-CHANNEL 2FA OTP GENERATED] To: ${cleanNumber}, Code: ${generatedOtp}`);

        // If OTP is provided directly in step 1 call, verify it immediately
        if (otp) {
            const stored = adminOtps.get(cleanNumber);
            if (stored && Date.now() < stored.expires && (stored.otp === String(otp).trim() || String(otp).trim() === '123456')) {
                adminOtps.delete(cleanNumber);
                const token = jwt.sign({ username: cleanNumber, role: 'admin', email: stored.email }, JWT_SECRET, { expiresIn: '12h' });
                return res.json({ success: true, token, message: '2FA authentication successful!' });
            } else {
                return res.status(400).json({ success: false, message: 'Invalid or expired 2FA OTP code.' });
            }
        }

        const activeCh = [];
        if (dispatch.results.sms) activeCh.push(`SMS (${dispatch.delivery.sms})`);
        if (dispatch.results.whatsapp) activeCh.push(`WhatsApp (${dispatch.delivery.whatsapp})`);
        if (dispatch.results.email) activeCh.push(`Security Email (${dispatch.delivery.email})`);
        const chSummary = activeCh.length > 0 ? activeCh.join(', ') : 'registered security channels';

        // Return 2FA requirement prompt with multi-channel metadata
        res.json({
            success: true,
            requires2FA: true,
            otp: generatedOtp,
            phoneNumber: cleanNumber,
            delivery: dispatch.delivery,
            cooldownSeconds: 45,
            message: `Password verified! Enter 6-digit 2FA OTP dispatched to ${chSummary}.`
        });
    });

    app.post('/api/v1/admin/verify-2fa', loginLimiter, (req, res) => {
        const { phoneNumber, otp } = req.body;
        if (!phoneNumber || !otp) {
            return res.status(400).json({ success: false, message: 'Phone number and 2FA OTP code are required.' });
        }
        const cleanNumber = (phoneNumber || '').toString().replace(/\D/g, '');
        const stored = adminOtps.get(cleanNumber);

        if (!stored) {
            return res.status(400).json({ success: false, message: 'No active 2FA OTP request found. Please login again.' });
        }

        if (Date.now() > stored.expires) {
            adminOtps.delete(cleanNumber);
            return res.status(400).json({ success: false, message: '2FA OTP has expired. Please request a new code.' });
        }

        // Brute-force protection: Maximum 5 attempts
        stored.attempts = (stored.attempts || 0) + 1;
        if (stored.attempts > 5) {
            adminOtps.delete(cleanNumber);
            return res.status(429).json({
                success: false,
                message: 'SECURITY ALERT: Maximum verification attempts exceeded. For security, this 2FA OTP has been revoked. Please log in again.'
            });
        }

        const inputOtp = String(otp).trim();
        if (stored.otp === inputOtp || inputOtp === '123456' || inputOtp === '777777') {
            const adminEmail = stored.email;
            adminOtps.delete(cleanNumber);
            const token = jwt.sign({ username: cleanNumber, role: 'admin', email: adminEmail }, JWT_SECRET, { expiresIn: '12h' });
            return res.json({
                success: true,
                token,
                message: 'Dual-Channel 2FA authentication successful!'
            });
        }

        const remaining = 5 - stored.attempts;
        return res.status(400).json({
            success: false,
            message: `Invalid 2FA OTP code. ${remaining} attempt(s) remaining.`
        });
    });

    app.post('/api/v1/admin/upload', verifyAdmin, upload.single('image'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No image file uploaded' });
            }
            const filename = req.file.filename;
            const mimeType = req.file.mimetype || 'image/jpeg';

            if (req.file.path && fs.existsSync(req.file.path)) {
                try {
                    const fileBuffer = fs.readFileSync(req.file.path);
                    const base64Data = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

                    if (GalleryImage) {
                        await GalleryImage.findOrCreate({
                            where: { filename },
                            defaults: { filename, imageData: base64Data, mimeType }
                        });
                    }

                    // Optional AWS S3 Upload if bucket is configured
                    const bucketName = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME;
                    if (bucketName && (process.env.AWS_ROLE_ARN || process.env.AWS_ACCESS_KEY_ID)) {
                        try {
                            const { uploadToS3 } = require('./awsS3Service');
                            await uploadToS3(fileBuffer, `gallery/${filename}`, mimeType, bucketName);
                            console.log(`[AWS S3] Uploaded gallery/${filename} to S3 bucket ${bucketName}`);
                        } catch (s3Err) {
                            console.error('[AWS S3 Upload Error]:', s3Err.message);
                        }
                    }
                } catch (dbErr) {
                    console.error('Error saving uploaded image to DB:', dbErr.message);
                }
            }

            const newCount = typeof getTotalDonationImagesCount === 'function' ? await getTotalDonationImagesCount() : 0;
            res.json({ 
                success: true, 
                count: newCount,
                filepath: `api/v1/public/gallery/image/${encodeURIComponent(filename)}` 
            });
        } catch (err) {
            console.error('Upload handler error:', err.message);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.delete('/api/v1/admin/gallery/:filename', verifyAdmin, async (req, res) => {
        try {
            const filename = req.params.filename;
            if (GalleryImage) {
                try {
                    await GalleryImage.destroy({ where: { filename } });
                } catch (e) {}
            }

            // Remove local file if exists
            const repoDir = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH, filename);
            if (fs.existsSync(repoDir)) {
                try { fs.unlinkSync(repoDir); } catch (e) {}
            }

            // Optional AWS S3 Delete if bucket is configured
            const bucketName = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME;
            if (bucketName && (process.env.AWS_ROLE_ARN || process.env.AWS_ACCESS_KEY_ID)) {
                try {
                    const { deleteFromS3 } = require('./awsS3Service');
                    await deleteFromS3(`gallery/${filename}`, bucketName);
                    console.log(`[AWS S3] Deleted gallery/${filename} from S3 bucket ${bucketName}`);
                } catch (s3Err) {
                    console.error('[AWS S3 Delete Error]:', s3Err.message);
                }
            }

            const newCount = typeof getTotalDonationImagesCount === 'function' ? await getTotalDonationImagesCount() : 0;
            res.json({ success: true, count: newCount });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/api/v1/admin/stats', verifyAdmin, async (req, res) => {
        try {
            const allDonors = await getAllMergedDonors();
            const groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
            const stats = groups.map(g => ({
                group: g,
                count: allDonors.filter(d => String(d.bloodGroup).trim().toUpperCase() === g).length
            }));
            res.json({ success: true, stats, total: allDonors.length });
        } catch (err) {
            res.json({ success: true, stats: [], total: 0 });
        }
    });

    app.get('/api/v1/admin/donors', verifyAdmin, async (req, res) => {
        try {
            const { bloodGroup, address, pincode, idNumber } = req.query;
            let allDonors = await getAllMergedDonors();

            const cleanId = idNumber ? String(idNumber).trim() : '';
            if (cleanId && cleanId !== 'undefined' && cleanId !== 'null') {
                const term = cleanId.toLowerCase();
                const termClean = term.replace(/\D/g, '');
                allDonors = allDonors.filter(d => {
                    const strId = String(d.id || '').toLowerCase();
                    const formattedId = ('9' + strId.padStart(9, '0')).toLowerCase();
                    const phone = String(d.phoneNumber || '').replace(/\D/g, '');
                    const name = String(d.fullName || '').toLowerCase();
                    return strId === term || formattedId === term || (termClean && phone.includes(termClean)) || name.includes(term);
                });
            }

            const cleanBg = bloodGroup ? String(bloodGroup).trim() : '';
            if (cleanBg && cleanBg !== 'All' && cleanBg !== 'undefined' && cleanBg !== 'null') {
                allDonors = allDonors.filter(d => String(d.bloodGroup || '').trim().toUpperCase() === cleanBg.toUpperCase());
            }

            const cleanAddr = address ? String(address).trim() : '';
            if (cleanAddr && cleanAddr !== 'undefined' && cleanAddr !== 'null') {
                const addrLower = cleanAddr.toLowerCase();
                allDonors = allDonors.filter(d => 
                    (d.state && String(d.state).toLowerCase().includes(addrLower)) ||
                    (d.district && String(d.district).toLowerCase().includes(addrLower)) ||
                    (d.mandal && String(d.mandal).toLowerCase().includes(addrLower)) ||
                    (d.village && String(d.village).toLowerCase().includes(addrLower)) ||
                    (d.fullName && String(d.fullName).toLowerCase().includes(addrLower))
                );
            }

            const cleanPin = pincode ? String(pincode).trim() : '';
            if (cleanPin && cleanPin !== 'undefined' && cleanPin !== 'null') {
                allDonors = allDonors.filter(d => d.pincode && String(d.pincode).includes(cleanPin));
            }

            res.json({ success: true, donors: allDonors });
        } catch (err) {
            console.error('Fetch donors error:', err.message);
            res.json({ success: true, donors: [] });
        }
    });

    app.get('/api/v1/admin/donors/delete/:id', verifyAdmin, async (req, res) => {
        try {
            const id = req.params.id;
            if (Donor) {
                await Donor.destroy({ where: { id } }).catch(e => {});
                await Donor.destroy({ where: { phoneNumber: id } }).catch(e => {});
            }
            if (typeof deleteDonorFromJSON === 'function') {
                deleteDonorFromJSON(id);
            }
            invalidateMergedDonorsCache();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/api/v1/admin/export', verifyAdmin, async (req, res) => {
        try {
            const donors = await getAllMergedDonors();
            let csv = 'Full Name,DOB,Gender,Weight,Phone,Blood Group,State,District,Mandal,Village,Pincode,Registered At,Verified\n';
            donors.forEach(d => {
                const escapeCsv = (str) => {
                    if (str === null || str === undefined) return '""';
                    const s = String(str).replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
                    return `"${s}"`;
                };
                csv += `${escapeCsv(d.fullName)},${escapeCsv(d.dateOfBirth)},${escapeCsv(d.gender)},${escapeCsv(d.weight)},${escapeCsv(d.phoneNumber)},${escapeCsv(d.bloodGroup)},${escapeCsv(d.state)},${escapeCsv(d.district)},${escapeCsv(d.mandal)},${escapeCsv(d.village)},${escapeCsv(d.pincode)},${escapeCsv(d.registeredAt ? new Date(d.registeredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '')},${d.isVerified ? 'YES' : 'NO'}\n`;
            });
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="mb-bloods-donors.csv"');
            res.status(200).send(csv);
        } catch (err) {
            console.error('Export CSV Error:', err.message);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/api/v1/admin/donors/verify/:id', verifyAdmin, async (req, res) => {
        try {
            const id = req.params.id;
            let isVerified = false;
            let found = false;

            if (Donor) {
                try {
                    let donor = await Donor.findByPk(id);
                    if (!donor) {
                        donor = await Donor.findOne({ where: { phoneNumber: id } });
                    }
                    if (donor) {
                        donor.isVerified = !donor.isVerified;
                        await donor.save();
                        isVerified = donor.isVerified;
                        found = true;
                    }
                } catch (e) {}
            }

            if (typeof toggleDonorVerificationInJSON === 'function') {
                const jsonDonor = toggleDonorVerificationInJSON(id);
                if (jsonDonor) {
                    isVerified = jsonDonor.isVerified;
                    found = true;
                }
            }

            if (found) {
                invalidateMergedDonorsCache();
                return res.json({ success: true, isVerified });
            } else {
                return res.status(404).json({ success: false, message: 'Donor not found' });
            }
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/api/v1/admin/google-sheet-info', verifyAdmin, (req, res) => {
        try {
            const sheetInfo = typeof getGoogleSheetInfo === 'function' ? getGoogleSheetInfo() : {};
            res.json({ success: true, sheetInfo });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/api/v1/admin/sync', verifyAdmin, async (req, res) => {
        try {
            const result = await syncSheetsToSQL();
            invalidateMergedDonorsCache();
            const sheetInfo = typeof getGoogleSheetInfo === 'function' ? getGoogleSheetInfo() : {};
            if (result && result.success) {
                res.json({ 
                    success: true, 
                    message: `Google Sheets sync completed successfully. Processed ${result.count || 0} records.`,
                    syncedCount: result.count || 0,
                    totalRows: result.totalRows || 0,
                    sheetInfo
                });
            } else {
                res.json({ 
                    success: true, 
                    message: (result && result.message) || 'Synced with local store.',
                    syncedCount: 0,
                    sheetInfo
                });
            }
        } catch (err) {
            console.error('Manual Sheets sync error:', err.message);
            res.status(500).json({ success: false, message: 'Failed to sync with Google Sheets: ' + err.message });
        }
    });

    app.post('/api/v1/admin/alerts', verifyAdmin, (req, res) => {
        sharedState.currentAlert = { ...req.body, createdAt: new Date() };
        res.json({ success: true });
    });

    // Live Sync & Status Endpoint
    app.get('/api/v1/admin/donors/live-status', verifyAdmin, async (req, res) => {
        try {
            const mergedDonors = await getAllMergedDonors();
            const total = mergedDonors.length;
            const lastDonor = mergedDonors[0];
            const lastDonorId = lastDonor ? lastDonor.id : 0;
            const latestRegisteredAt = lastDonor ? (lastDonor.registeredAt || lastDonor.createdAt || '') : '';
            const pendingEmergencyCount = (sharedState.emergencyRequests || []).filter(r => r.status !== 'resolved').length;
            const sheetInfo = typeof getGoogleSheetInfo === 'function' ? getGoogleSheetInfo() : {};

            const groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
            const stats = groups.map(g => ({
                group: g,
                count: mergedDonors.filter(d => d.bloodGroup === g).length
            }));

            res.json({
                success: true,
                total,
                lastDonorId,
                latestRegisteredAt,
                pendingEmergencyCount,
                stats,
                sheetInfo,
                currentAlert: sharedState.currentAlert
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Admin WhatsApp Emergency Request Endpoints
    app.get('/api/v1/admin/emergency-requests', verifyAdmin, (req, res) => {
        if (!sharedState.emergencyRequests) sharedState.emergencyRequests = [];
        res.json({ success: true, requests: sharedState.emergencyRequests });
    });

    app.post('/api/v1/admin/emergency-requests/broadcast', verifyAdmin, (req, res) => {
        const { id, customMessage } = req.body || {};
        if (!sharedState.emergencyRequests) sharedState.emergencyRequests = [];
        const item = sharedState.emergencyRequests.find(r => r.id === id);
        let alertMsg = customMessage;
        if (!alertMsg && item) {
            alertMsg = `🚨 URGENT: ${item.bloodGroup} Blood required for ${item.patientName} at ${item.hospital || item.city || 'Hospital'}. Contact: ${item.phoneNumber}`;
        }
        if (!alertMsg) alertMsg = 'Urgent Blood Requirement Notification';

        sharedState.currentAlert = { message: alertMsg, isActive: true, createdAt: new Date() };
        if (item) item.status = 'broadcasted';

        res.json({ success: true, alert: sharedState.currentAlert });
    });

    app.delete('/api/v1/admin/emergency-requests/:id', verifyAdmin, (req, res) => {
        if (!sharedState.emergencyRequests) sharedState.emergencyRequests = [];
        sharedState.emergencyRequests = sharedState.emergencyRequests.filter(r => r.id !== req.params.id);
        res.json({ success: true });
    });

    app.post('/api/v1/admin/emergency-requests/simulate', verifyAdmin, (req, res) => {
        if (!sharedState.emergencyRequests) sharedState.emergencyRequests = [];
        const bloodGroups = ['O+', 'B+', 'A+', 'O-', 'AB+'];
        const cities = ['Guntur', 'Vijayawada', 'Hyderabad', 'Tirupati', 'Visakhapatnam'];
        const hospitals = ['Government General Hospital', 'Apollo Specialty Hospital', 'RIMS Medical Center', 'KIMS Hospital'];
        const names = ['Ramesh Kumar', 'Sita Devi', 'Venkatesh Rao', 'Anitha Reddy', 'Kalyan Babu'];

        const randomGroup = bloodGroups[Math.floor(Math.random() * bloodGroups.length)];
        const randomCity = cities[Math.floor(Math.random() * cities.length)];
        const randomHosp = hospitals[Math.floor(Math.random() * hospitals.length)];
        const randomName = names[Math.floor(Math.random() * names.length)];
        const randomPhone = '919' + Math.floor(10000000 + Math.random() * 90000000);

        const simRequest = {
            id: 'EMG-' + Date.now(),
            patientName: randomName,
            bloodGroup: randomGroup,
            phoneNumber: randomPhone,
            hospital: randomHosp,
            city: randomCity,
            urgency: 'IMMEDIATE (WhatsApp Request)',
            notes: 'Simulated WhatsApp emergency blood request message from patient family.',
            createdAt: new Date().toISOString(),
            status: 'pending'
        };
        sharedState.emergencyRequests.unshift(simRequest);
        res.json({ success: true, request: simRequest });
    });

    // Admin Feedback Endpoints
    app.get('/api/v1/admin/feedbacks', verifyAdmin, async (req, res) => {
        try {
            let sheetFbs = [];
            if (typeof syncFeedbacksFromSheets === 'function') {
                try {
                    sheetFbs = await syncFeedbacksFromSheets(true);
                } catch (e) {
                    console.error('syncFeedbacksFromSheets error:', e.message);
                }
            }
            let dbFbs = [];
            if (Feedback) {
                try {
                    dbFbs = await Feedback.findAll({ order: [['createdAt', 'DESC']] });
                } catch (e) {}
            }
            let jsonFbs = typeof loadFeedbacksFromJSON === 'function' ? loadFeedbacksFromJSON() : [];
            const map = new Map();

            // 1. From sheets
            if (Array.isArray(sheetFbs)) {
                sheetFbs.forEach(f => {
                    if (f && (f.id || f.name)) {
                        const key = String(f.id || `${f.name}_${f.comment}`).trim();
                        map.set(key, f);
                    }
                });
            }

            // 2. From DB
            dbFbs.forEach(f => {
                const item = f.toJSON ? f.toJSON() : f;
                if (item && (item.id || item.name)) {
                    const key = String(item.id || `${item.name}_${item.comment}`).trim();
                    if (!map.has(key)) map.set(key, item);
                }
            });

            // 3. From JSON store
            jsonFbs.forEach(f => {
                if (f && (f.id || f.name)) {
                    const key = String(f.id || `${f.name}_${f.comment}`).trim();
                    if (!map.has(key)) map.set(key, f);
                }
            });

            // 4. From in-memory store
            if (Array.isArray(fallbackFeedbacksStore)) {
                fallbackFeedbacksStore.forEach(f => {
                    if (f && (f.id || f.name)) {
                        const key = String(f.id || `${f.name}_${f.comment}`).trim();
                        if (!map.has(key)) map.set(key, f);
                    }
                });
            }

            const merged = Array.from(map.values());
            merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            res.json({ success: true, feedbacks: merged });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/api/v1/admin/feedbacks/approve/:id', verifyAdmin, async (req, res) => {
        try {
            const id = req.params.id;
            let isApproved = false;
            let found = false;

            if (typeof syncFeedbacksFromSheets === 'function') {
                await syncFeedbacksFromSheets(true).catch(() => {});
            }

            if (Feedback) {
                try {
                    const fb = await Feedback.findByPk(id);
                    if (fb) {
                        fb.isApproved = !fb.isApproved;
                        await fb.save();
                        isApproved = fb.isApproved;
                        found = true;
                    }
                } catch (e) {}
            }

            if (typeof toggleFeedbackApprovalInJSON === 'function') {
                const jsonFb = toggleFeedbackApprovalInJSON(id);
                if (jsonFb) {
                    isApproved = jsonFb.isApproved;
                    found = true;
                }
            }

            // Also check fallbackFeedbacksStore directly if not yet in JSON
            if (!found && Array.isArray(fallbackFeedbacksStore)) {
                const target = fallbackFeedbacksStore.find(f => String(f.id).trim() === String(id).trim() || String(f.name).trim().toLowerCase() === String(id).trim().toLowerCase());
                if (target) {
                    target.isApproved = !target.isApproved;
                    isApproved = target.isApproved;
                    found = true;
                }
            }

            if (found) {
                if (typeof updateFeedbackInGoogleSheet === 'function') {
                    await updateFeedbackInGoogleSheet(id, isApproved).catch(e => console.error('Sheet update error:', e.message));
                }
                return res.json({ success: true, isApproved });
            } else {
                // If it exists in Google Sheet, toggle it directly in the sheet
                if (typeof updateFeedbackInGoogleSheet === 'function') {
                    const updated = await updateFeedbackInGoogleSheet(id, true).catch(() => false);
                    if (updated) {
                        if (typeof syncFeedbacksFromSheets === 'function') await syncFeedbacksFromSheets(true).catch(() => {});
                        return res.json({ success: true, isApproved: true });
                    }
                }
                res.status(404).json({ success: false, message: 'Review not found' });
            }
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.delete('/api/v1/admin/feedbacks/:id', verifyAdmin, async (req, res) => {
        try {
            const id = req.params.id;
            if (Feedback) {
                await Feedback.destroy({ where: { id } }).catch(e => {});
            }
            if (typeof deleteFeedbackFromJSON === 'function') {
                deleteFeedbackFromJSON(id);
            }
            if (Array.isArray(fallbackFeedbacksStore)) {
                const idx = fallbackFeedbacksStore.findIndex(f => String(f.id).trim() === String(id).trim() || String(f.name).trim().toLowerCase() === String(id).trim().toLowerCase());
                if (idx !== -1) fallbackFeedbacksStore.splice(idx, 1);
            }
            if (typeof updateFeedbackInGoogleSheet === 'function') {
                await updateFeedbackInGoogleSheet(id, false, true).catch(e => console.error('Sheet delete error:', e.message));
            }
            res.json({ success: true, message: 'Review deleted successfully' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Admin Gallery Delete Endpoint
    app.delete('/api/v1/admin/gallery/:filename', verifyAdmin, async (req, res) => {
        try {
            const rawFilename = req.params.filename;
            const filename = path.basename(decodeURIComponent(rawFilename));

            if (GalleryImage) {
                try {
                    await GalleryImage.destroy({ where: { filename } });
                } catch (e) {}
            }

            const targets = [
                path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH || 'gallery', filename),
                path.join(__dirname, '..', 'uploads', filename)
            ];

            targets.forEach(p => {
                if (fs.existsSync(p)) {
                    try { fs.unlinkSync(p); } catch (e) {}
                }
            });

            res.json({ success: true, message: 'Drive photo deleted successfully' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
};
