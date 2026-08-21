# 🚀 Deployment Guide: Mahesh Babu Bloods (SQL Version)

Moving your application from local development to production (Vercel) requires a few configuration steps for your **SQL Database** and **Google Sheets** integration.

## 1. AWS RDS PostgreSQL Database Setup

1. Provision your **AWS RDS / Aurora PostgreSQL** database instance in AWS Console (`database-1-instance-1.cz0siasmowue.ap-south-1.rds.amazonaws.com`).
2. Run the SQL schema from [`supabase_schema.sql`](file:///d:/mb%20bloods/supabase_schema.sql) to initialize the `"Donors"` and `"Feedbacks"` tables.
3. Configure your verified `DATABASE_URL` connection string:
   `postgresql://postgres:<YOUR_AWS_RDS_PASSWORD>@database-1-instance-1.cz0siasmowue.ap-south-1.rds.amazonaws.com:5432/postgres?sslmode=require`

## 2. Vercel Deployment Steps

### Step 1: Login & Deploy via Vercel CLI
1. Open your terminal in the project root directory.
2. Log in to Vercel:
   ```bash
   npx vercel login
   ```
3. Link the Vercel project:
   ```bash
   npx vercel link --scope satyachandra7s-projects
   ```

### Step 2: Configure Environment Variables on Vercel
Go to your **Vercel Dashboard > Settings > Environment Variables** and add the following:
* `DATABASE_URL`: `postgresql://postgres:<YOUR_AWS_RDS_PASSWORD>@database-1-instance-1.cz0siasmowue.ap-south-1.rds.amazonaws.com:5432/postgres?sslmode=require`

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

---

## 6. AWS OIDC Web Identity Integration (Passwordless AWS Access on Vercel)

To allow Vercel serverless functions to authenticate with AWS services (e.g., S3, DynamoDB) securely without long-lived access keys:

### Step 1: Create an IAM OIDC Identity Provider in AWS
1. Open the **AWS IAM Console** $\rightarrow$ **Identity providers** $\rightarrow$ **Add provider**.
2. Select **OpenID Connect**.
3. **Provider URL**: `https://oidc.vercel.com/satyachandra7s-projects`
4. **Audience**: `https://vercel.com/satyachandra7s-projects`

### Step 2: Create IAM Role with Trust Policy (`mb_bloods`)
1. In IAM, go to **Roles** $\rightarrow$ **Create role** $\rightarrow$ Select **Web identity**.
2. Select the Vercel OIDC provider created above.
3. Configure the **Trust Policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::771448468204:oidc-provider/oidc.vercel.com/satyachandra7s-projects"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/satyachandra7s-projects:aud": "https://vercel.com/satyachandra7s-projects"
        },
        "StringLike": {
          "oidc.vercel.com/satyachandra7s-projects:sub": "owner:satyachandra7s-projects:project:mahesh-babu-bloods-8j6o:environment:*"
        }
      }
    }
  ]
}
```
4. Attach permissions policies (e.g., `AmazonS3FullAccess`).
5. Save the role as `mb_bloods` (`arn:aws:iam::771448468204:role/mb_bloods`).

### Step 3: Configure Vercel Environment Variables
Add the following in **Vercel Project Settings > Environment Variables**:
* `AWS_ROLE_ARN`: `arn:aws:iam::771448468204:role/mb_bloods`
* `AWS_REGION`: `us-east-1`

### Step 4: Use in Application Code
Import and use the pre-configured AWS helper module ([`backend/awsClient.js`](file:///d:/mb%20bloods/backend/awsClient.js)):
```javascript
const { getS3Client } = require('./awsClient');
const { ListBucketsCommand } = require('@aws-sdk/client-s3');

const s3 = getS3Client();
const response = await s3.send(new ListBucketsCommand({}));
```

---

## 7. Amazon Aurora PostgreSQL Database Setup & Connection

To use Amazon Aurora PostgreSQL Serverless v2 with Vercel serverless functions:

### Step 1: Create Amazon Aurora Serverless v2 PostgreSQL Cluster
1. Open the **AWS RDS Console** $\rightarrow$ **Databases** $\rightarrow$ Click **Create database**.
2. Select **Standard create**.
3. **Engine type**: **Amazon Aurora (PostgreSQL-Compatible Edition)**.
4. **Templates**: **Production** or **Dev/Test**.
5. **Settings**:
   - DB Cluster Identifier: `mb-bloods-aurora-db`
   - Master username: `postgres`
   - Master password: Set a strong master password (e.g. `MaheshBabuBloods2026!`).
6. **Instance configuration**:
   - Select **Serverless v2**.
   - Capacity range: Min ACU = `0.5`, Max ACU = `8.0` (auto-scaling).
7. **Connectivity**:
   - **Publicly Accessible**: Select **Yes** (or use RDS Proxy).
   - VPC Security Group: Allow inbound PostgreSQL traffic on Port `5432` from `0.0.0.0/0` (or Vercel IP range).
8. Click **Create database**.

### Step 2: Create AWS RDS Proxy for Vercel Connection Pooling (Recommended)
1. In RDS Console, go to **Proxies** $\rightarrow$ Click **Create proxy**.
2. **Proxy configuration**:
   - Proxy Identifier: `mb-bloods-rds-proxy`
   - Engine: PostgreSQL
3. **Target group configuration**:
   - Database: Select `mb-bloods-aurora-db`.
4. **Authentication**:
   - Select Secrets Manager secret containing your DB credentials (`postgres` username & password).
5. **Require TLS/SSL**: Checked.
6. Click **Create proxy** and copy the **Proxy Endpoint** (e.g., `mb-bloods-rds-proxy.proxy-xxxx.us-east-1.rds.amazonaws.com`).

### Step 3: Configure Database Connection String
Set `DATABASE_URL` in **Vercel Project Settings > Environment Variables**, [`.env.local`](file:///d:/mb%20bloods/.env.local), and [`backend/.env`](file:///d:/mb%20bloods/backend/.env):

```env
DATABASE_URL="postgresql://postgres:<YOUR_PASSWORD>@<AURORA_OR_RDS_PROXY_ENDPOINT>:5432/postgres?sslmode=require"
```

### Step 4: Initialize Database Tables
Run the SQL schema in [`supabase_schema.sql`](file:///d:/mb%20bloods/supabase_schema.sql) against your Aurora PostgreSQL database using psql or any database client:
```bash
psql "postgresql://postgres:<YOUR_PASSWORD>@<AURORA_ENDPOINT>:5432/postgres?sslmode=require" -f supabase_schema.sql
```
Alternatively, launching the backend will automatically sync tables via Sequelize on startup.




