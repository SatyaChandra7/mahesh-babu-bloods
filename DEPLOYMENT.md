# 🚀 Deployment Guide: Mahesh Babu Bloods (SQL Version)

Moving your application from local development to production (Vercel) requires a few configuration steps for your **SQL Database** and **Google Sheets** integration.

## 1. Database Choice

This application uses **SQLite** for local development. For production deployment on Vercel:
* **Option A (Simplest):** Continue using SQLite. A `database.sqlite` file will be created on the server disk. Note: Vercel serverless functions have an ephemeral filesystem, so the database will reset after some inactivity unless you use an external SQL provider.
* **Option B (Recommended for Production):** Use **Postgres**. You can easily switch to a Postgres database (like Vercel Postgres or Supabase) by updating the connection configuration in `server.js`.

## 2. Vercel Environment Variables

1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Navigate to **Settings > Environment Variables**.
3. Add:
   * `JWT_SECRET`: `mbbloods-super-secret-key-123`
   * `ADMIN1_USER`: `satya`
   * `ADMIN1_PASS`: `Chandu@0713#`
   * `ADMIN2_USER`: `mahesh`
   * `ADMIN2_PASS`: `Bloods@0809#`
   * `GOOGLE_SPREADSHEET_ID`: `1E2g-qu5tpzv5npT7h0Q7_wFVhIr1AANehi_UdKH4wLw`

## 3. Google Sheets Access

The application automatically synchronizes data from **Google Sheets** into the SQL database on every startup. This ensures your data persists even if the local SQL file is reset.

1. Ensure your Google Sheet is shared with the **Client Email** in your `service-account.json`.
2. Give the email **Editor** permissions.

## 4. Local Development

* The application will automatically create a `database.sqlite` file in the root directory.
* Run `npm install` and `npm start` to begin.
* The backend will attempt to sync your current Google Sheet data into the database on the first run.
