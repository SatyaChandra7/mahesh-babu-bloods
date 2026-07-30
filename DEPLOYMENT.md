# 🚀 Deployment Guide: Mahesh Babu Bloods (SQL Version)

Moving your application from local development to production (Vercel) requires a few configuration steps for your **SQL Database** and **Google Sheets** integration.

## 1. Supabase Database Setup

1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Open your project, go to **SQL Editor**, and run the SQL contents from [`supabase_schema.sql`](file:///d:/mb%20bloods/supabase_schema.sql).
   This creates the `"Donors"` and `"Feedbacks"` tables, performance indexes, and enables Row Level Security (RLS) policies.
3. Go to **Project Settings > Database > Connection String** and use your verified connection string:
   - **Transaction Pooler (Recommended for Vercel Serverless)**:
     `postgresql://postgres.jbuwmwcmuchxshuboofi:Mahesh%40094005@aws-0-us-east-1.pooler.supabase.com:6543/postgres`

## 2. Vercel Deployment Steps

### Step 1: Login & Deploy via Vercel CLI
1. Open your terminal in the project root directory.
2. Log in to Vercel:
   ```bash
   npx vercel login
   ```
3. Initialize the Vercel project and link it:
   ```bash
   npx vercel
   ```
   *Follow the prompts (choose default options).*

### Step 2: Configure Environment Variables on Vercel
Go to your **Vercel Dashboard > Settings > Environment Variables** and add the following:
* `DATABASE_URL`: `postgresql://postgres.jbuwmwcmuchxshuboofi:Mahesh%40094005@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
* `JWT_SECRET`: `fe7c86559f1a9c97e06425289364b3bfae49278692867adeb99c1b9a48d16dd78c5dbe18d66b5af387808b47b71c237d7285fb8a9142dffb1d28a73fd27ffcb2`
* `ADMIN_WHATSAPP_1`: `919948550301`
* `ADMIN_WHATSAPP_2`: `919491463888`
* `GOOGLE_SPREADSHEET_ID`: `1E2g-qu5tpzv5npT7h0Q7_wFVhIr1AANehi_UdKH4wLw`
* `GOOGLE_SHEET_NAME`: `Sheet1`
* `GALLERY_FOLDER`: `our work`
* `SUPPORT_EMAIL`: `MaheshBabuBloods@gmail.com`
* `GOOGLE_SERVICE_ACCOUNT_JSON`: *(The complete JSON content of your `service-account.json` file as a single string)*

### Step 3: Deploy to Production
Run the production deployment:
```bash
npx vercel --prod
```

### Serverless Execution Note
The backend includes a serverless auto-initialization middleware in `backend/index.js` that automatically initializes the PostgreSQL database connection and Google Sheets API on incoming API requests when deployed to Vercel.

## 3. Render & Vercel Cross-Domain Setup

### Step 1: Set Up CORS on Your Backend (Render)
Because your frontend (Vercel) and backend (Render) are hosted on different domains, CORS is enabled in `backend/index.js` using the `cors` package:

```javascript
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true
}));
```

On your **Render Dashboard**:
1. Go to your Web Service $\rightarrow$ **Environment Variables**.
2. Add/Edit `CORS_ORIGIN`: `https://your-frontend-app.vercel.app,http://localhost:5173` *(replace with your exact Vercel frontend URL)*.
3. Save and redeploy.

---

### Step 2: Set Your Backend URL in the Frontend (Vercel)
To point your frontend to your backend running on Render:
1. Copy your Render backend URL (e.g. `https://your-backend-service.onrender.com`).
2. Go to **Vercel Dashboard** $\rightarrow$ Select Frontend Project $\rightarrow$ **Settings** $\rightarrow$ **Environment Variables**.
3. Add a new variable:
   * **Key**: `VITE_API_BASE_URL` (or `API_BASE_URL`)
   * **Value**: `https://your-backend-service.onrender.com`
4. Click **Save** and **Redeploy** on Vercel.

---

### Step 3: API Calls in Frontend Code
Frontend components automatically read the configured URL via dynamic resolution:
```javascript
get apiBase() {
    const url = window.VITE_API_BASE_URL || window.REACT_APP_API_BASE_URL || window.API_BASE_URL || localStorage.getItem('API_BASE_URL') || '';
    return url.replace(/\/+$/, '');
}
```

---

### Step 4: Handle Render Free-Tier Cold Starts
Render's free tier puts web services to sleep after 15 minutes of inactivity. Initial requests after a sleep period take 30–50 seconds.

* **Frontend UI Indicator**: A top notification banner automatically displays `⚡ Connecting to backend server...` if initial responses take more than 2.5 seconds.
* **Keep-Alive Ping (UptimeRobot)**:
  1. Sign up for a free account at [UptimeRobot](https://uptimerobot.com/).
  2. Add a new monitor:
     * **Monitor Type**: HTTP(s)
     * **Friendly Name**: `MB Bloods Render Backend`
     * **URL/IP**: `https://your-backend-service.onrender.com/health`
     * **Monitoring Interval**: Every 10–14 minutes.
  3. Save. This pings `/health` regularly to keep your Render instance awake during active hours.

---

## 4. Google Sheets Access

1. Ensure your Google Sheet is shared with the **Client Email** in your `service-account.json`.
2. Give the email **Editor** permissions.

---

## 5. Local Development

* The application will automatically create a `database.sqlite` file in the root directory.
* Run `npm install` and `npm run dev` to begin.
* The backend will attempt to sync your current Google Sheet data into the database on the first run.

