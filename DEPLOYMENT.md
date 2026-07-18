# 🚀 Deployment Guide: Mahesh Babu Bloods (SQL Version)

Moving your application from local development to production (Vercel) requires a few configuration steps for your **SQL Database** and **Google Sheets** integration.

## 1. Database Choice

This application uses **SQLite** for local development. For production deployment on Vercel:
* **Option A:** Continue using SQLite. A `database.sqlite` file will be created in `/tmp`. Note: Vercel serverless functions have an ephemeral filesystem, so the database will reset after some inactivity.
* **Option B (Recommended for Production):** Use **Postgres** (like Supabase or Vercel Postgres). The connection configuration in [backend/index.js](file:///d:/mb%20bloods/backend/index.js) automatically connects to Postgres if the `DATABASE_URL` environment variable is defined.

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
* `DATABASE_URL`: `postgresql://postgres:Maheshbabu0809@db.komrntxfmoubhyckbkze.supabase.co:5432/postgres` (Your Supabase PostgreSQL connection string)
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

## 3. Google Sheets Access

1. Ensure your Google Sheet is shared with the **Client Email** in your `service-account.json`.
2. Give the email **Editor** permissions.

## 4. Local Development

* The application will automatically create a `database.sqlite` file in the root directory.
* Run `npm install` and `npm run dev` to begin.
* The backend will attempt to sync your current Google Sheet data into the database on the first run.
