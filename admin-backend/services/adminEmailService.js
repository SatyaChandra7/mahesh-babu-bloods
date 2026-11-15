const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Cache the HTML template in memory
let cachedTemplate = null;

function getEmailTemplate() {
    if (!cachedTemplate) {
        const templatePath = path.join(__dirname, '..', 'templates', 'admin-otp-email.html');
        if (fs.existsSync(templatePath)) {
            cachedTemplate = fs.readFileSync(templatePath, 'utf8');
        } else {
            // High-security fallback template
            cachedTemplate = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #0b0f19; color: #f3f4f6; max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid #1f2937;">
                    <div style="color: #ef4444; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: 2px;">🛡️ IDENTITY & ACCESS MANAGEMENT</div>
                    <h2 style="color: #ffffff; margin-top: 6px;">{{APPLICATION_NAME}}</h2>
                    <p style="color: #9ca3af;">Hello <strong>{{ADMIN_NAME}}</strong>,</p>
                    <p style="color: #9ca3af;">A high-privilege action has been requested: <strong>{{ACTION_NAME}}</strong>.</p>
                    <div style="font-family: monospace; font-size: 36px; font-weight: 900; letter-spacing: 10px; color: #ffffff; padding: 20px; background: #030712; border: 2px solid #ef4444; border-radius: 8px; text-align: center; margin: 20px 0;">
                        {{OTP_CODE}}
                    </div>
                    <p style="color: #f87171; font-size: 13px;">⏳ Valid for {{EXPIRATION_TIME}} (Single-use)</p>
                    <div style="background: rgba(220, 38, 38, 0.1); border-left: 4px solid #dc2626; padding: 12px; margin: 16px 0; font-size: 12px; color: #fca5a5;">
                        ⚠️ CRITICAL NOTICE: Do NOT share this code with anyone. System operators will never request it.
                    </div>
                    <div style="background: #1f2937; padding: 12px; border-radius: 6px; font-size: 12px; color: #9ca3af;">
                        <div><strong>IP:</strong> {{IP_ADDRESS}}</div>
                        <div><strong>Device:</strong> {{DEVICE_INFO}}</div>
                        <div><strong>Time:</strong> {{TIMESTAMP}}</div>
                    </div>
                </div>
            `;
        }
    }
    return cachedTemplate;
}

/**
 * Format timestamp in both UTC and IST
 */
function formatSecurityTimestamp(date = new Date()) {
    const d = new Date(date);
    const utcStr = d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const istStr = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    return `${utcStr} (${istStr} IST)`;
}

/**
 * Mask email for secure UI display
 * e.g. satya@gmail.com -> sa***@gmail.com
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string') return 'ad***@domain.com';
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const user = parts[0];
    const domain = parts[1];
    const visibleChars = Math.min(2, Math.max(1, Math.floor(user.length / 2)));
    return `${user.substring(0, visibleChars)}***@${domain}`;
}

/**
 * Mask a list of emails
 */
function maskEmailList(emails) {
    if (!Array.isArray(emails) || emails.length === 0) return 'ma***@gmail.com';
    return emails.map(maskEmail).join(', ');
}

/**
 * Mask phone number for secure UI display
 * e.g. 919948550301 -> +91 ******0301
 */
function maskPhoneNumber(phone) {
    if (!phone) return '***';
    const str = String(phone).replace(/\D/g, '');
    if (str.length < 6) return str;
    const last4 = str.slice(-4);
    const country = str.length > 10 ? `+${str.slice(0, str.length - 10)} ` : '+91 ';
    return `${country}******${last4}`;
}

/**
 * Gathers ALL inserted administrator emails from configuration and env
 */
function getAllAdminEmails() {
    const emails = new Set();

    // 1. Check comma-separated ADMIN_EMAILS or ADMIN_EMAIL_LIST
    const envList = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL_LIST || '';
    if (envList) {
        envList.split(',').forEach(item => {
            const clean = item.trim().toLowerCase();
            if (clean && clean.includes('@')) emails.add(clean);
        });
    }

    // 2. Check individual variables ADMIN_EMAIL, ADMIN_EMAIL_1, ADMIN_EMAIL_2, ADMIN_EMAIL_3
    ['ADMIN_EMAIL', 'ADMIN_EMAIL_1', 'ADMIN_EMAIL_2', 'ADMIN_EMAIL_3'].forEach(key => {
        const val = process.env[key];
        if (val) {
            const clean = val.trim().toLowerCase();
            if (clean && clean.includes('@')) emails.add(clean);
        }
    });

    // 3. Check mapping ADMIN_EMAIL_MAP
    const envMap = process.env.ADMIN_EMAIL_MAP || '';
    if (envMap) {
        envMap.split(',').forEach(pair => {
            const parts = pair.split(':');
            if (parts.length === 2) {
                const clean = parts[1].trim().toLowerCase();
                if (clean && clean.includes('@')) emails.add(clean);
            }
        });
    }

    // 4. Default fallback: maheshbabubloods@gmail.com
    if (emails.size === 0) {
        emails.add('maheshbabubloods@gmail.com');
    }

    return Array.from(emails);
}

/**
 * Resolve administrator profile (Name, Emails) by phone number
 */
function resolveAdminProfile(cleanNumber) {
    const rawNumber = String(cleanNumber || '').replace(/\D/g, '');
    const allEmails = getAllAdminEmails();

    const defaultNames = {
        '919948550301': 'Primary Administrator',
        '919491463888': 'Operations Administrator',
        '918758754005': 'Technical Administrator',
        '8758754005': 'Technical Administrator'
    };

    return {
        name: defaultNames[rawNumber] || 'System Administrator',
        email: allEmails[0] || 'maheshbabubloods@gmail.com',
        allEmails
    };
}

/**
 * Compiles the email HTML with security metadata and dynamic values
 */
function renderAdminOTPEmail({
    applicationName = 'MB Bloods Admin Portal',
    adminName = 'System Administrator',
    actionName = 'Admin Authentication & Session Initialization',
    otpCode = '123456',
    expirationTime = '5 Minutes',
    ipAddress = 'Unknown IP',
    deviceInfo = 'Secure Browser Session',
    lockoutUrl = 'https://admin.maheshbabubloods.org/security/lockout',
    securityContact = 'maheshbabubloods@gmail.com'
}) {
    let html = getEmailTemplate();
    const replacements = {
        '{{APPLICATION_NAME}}': applicationName,
        '{{ADMIN_NAME}}': adminName,
        '{{ACTION_NAME}}': actionName,
        '{{OTP_CODE}}': otpCode,
        '{{EXPIRATION_TIME}}': expirationTime,
        '{{TIMESTAMP}}': formatSecurityTimestamp(),
        '{{IP_ADDRESS}}': ipAddress,
        '{{DEVICE_INFO}}': deviceInfo,
        '{{LOCKOUT_URL}}': lockoutUrl,
        '{{SECURITY_CONTACT}}': securityContact
    };

    for (const [key, val] of Object.entries(replacements)) {
        html = html.split(key).join(val);
    }
    return html;
}

// Nodemailer Gmail transport instance
let gmailTransporter = null;

function getGmailTransporter() {
    const user = process.env.GMAIL_USER || 'maheshbabubloods@gmail.com';
    const pass = (process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS || process.env.SMTP_PASS || '').trim();

    if (!pass) return null;

    if (!gmailTransporter) {
        gmailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user,
                pass
            }
        });
    }
    return gmailTransporter;
}

/**
 * Sends privileged Admin OTP Email from maheshbabubloods@gmail.com to ALL admin emails
 */
async function sendAdminOTPEmail({
    toEmails = null,
    adminName = 'System Administrator',
    actionName = 'Admin Portal Login',
    otpCode,
    expirationMinutes = 5,
    req = null
}) {
    const senderEmail = process.env.GMAIL_USER || 'maheshbabubloods@gmail.com';
    const applicationName = process.env.APP_NAME || 'MB Bloods Admin Portal';
    const securityContact = process.env.SECURITY_EMAIL || 'maheshbabubloods@gmail.com';
    
    // Resolve all admin emails inserted
    let recipients = [];
    if (Array.isArray(toEmails) && toEmails.length > 0) {
        recipients = toEmails;
    } else if (typeof toEmails === 'string' && toEmails.trim()) {
        recipients = toEmails.split(',').map(e => e.trim()).filter(Boolean);
    } else {
        recipients = getAllAdminEmails();
    }

    // Extract request audit metadata if express req is provided
    let ipAddress = '127.0.0.1';
    let deviceInfo = 'Secure Web Terminal';
    if (req) {
        ipAddress = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1')
            .toString().split(',')[0].trim();
        deviceInfo = (req.headers['user-agent'] || 'Administrative API Client').substring(0, 120);
    }

    const htmlContent = renderAdminOTPEmail({
        applicationName,
        adminName,
        actionName,
        otpCode,
        expirationTime: `${expirationMinutes} Minutes`,
        ipAddress,
        deviceInfo,
        securityContact
    });

    const subject = `URGENT: ${otpCode} is your privileged verification code for ${applicationName}`;

    // 1. Try sending via Nodemailer using Gmail SMTP (maheshbabubloods@gmail.com)
    const transporter = getGmailTransporter();
    if (transporter) {
        try {
            const mailOptions = {
                from: `"MB Bloods Security" <${senderEmail}>`,
                to: recipients.join(', '),
                subject,
                html: htmlContent
            };

            const info = await transporter.sendMail(mailOptions);
            console.log(`[GMAIL OTP SENT] From: ${senderEmail} -> To: ${recipients.join(', ')} | Message ID: ${info.messageId}`);
            return {
                success: true,
                channel: 'email',
                provider: 'gmail',
                sender: senderEmail,
                recipients,
                messageId: info.messageId
            };
        } catch (err) {
            console.error('[GMAIL SMTP ERROR]:', err.message);
        }
    }

    // 2. Try sending via Resend API if configured
    if (process.env.RESEND_API_KEY) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: `MB Bloods Security <${senderEmail}>`,
                    to: recipients,
                    subject,
                    html: htmlContent
                })
            });
            const data = await res.json();
            console.log(`[RESEND OTP SENT] From: ${senderEmail} -> To: ${recipients.join(', ')} | ID: ${data.id}`);
            return {
                success: true,
                channel: 'email',
                provider: 'resend',
                sender: senderEmail,
                recipients,
                id: data.id
            };
        } catch (err) {
            console.error('[RESEND API ERROR]:', err.message);
        }
    }

    // 3. Fallback / Dev Log Mock
    console.log(`================================================================`);
    console.log(`🛡️  [ADMIN PRIVILEGED 2FA EMAIL DISPATCH]`);
    console.log(`Sender:      ${senderEmail}`);
    console.log(`Recipients:  ${recipients.join(', ')} (ALL ADMIN MAILS)`);
    console.log(`Subject:     ${subject}`);
    console.log(`OTP Code:    ${otpCode}`);
    console.log(`Action:      ${actionName}`);
    console.log(`Source IP:   ${ipAddress}`);
    console.log(`Client:      ${deviceInfo}`);
    console.log(`Notice:      Add GMAIL_APP_PASSWORD to .env to deliver real emails via Google SMTP`);
    console.log(`================================================================`);

    return {
        success: true,
        channel: 'email',
        provider: 'mock',
        sender: senderEmail,
        recipients,
        mock: true
    };
}

module.exports = {
    renderAdminOTPEmail,
    sendAdminOTPEmail,
    formatSecurityTimestamp,
    maskEmail,
    maskEmailList,
    maskPhoneNumber,
    getAllAdminEmails,
    resolveAdminProfile
};
