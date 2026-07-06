# Mahesh Babu Bloods Backend Setup (SQL Version)

This backend is built using **Node.js**, **Express.js**, and **Sequelize (SQLite)** to handle donor registration and data synchronization with Google Sheets.

## Prerequisites

1. **Node.js**: [Download and Install Node.js](https://nodejs.org/).
2. **SQLite**: No separate installation required, the application uses an embedded `database.sqlite` file.

## Setup Instructions

1. Open your terminal and navigate to the project directory:

   ```bash
   cd "d:\mb bloods"
   ```

2. Install the required dependencies:

   ```bash
   npm install
   ```

3. Configure your environment:

   - Open the `.env` file in the root directory.
   - Set your `GOOGLE_SPREADSHEET_ID` and admin credentials.

4. Start the backend server:

   ```bash
   npm start
   ```

   Your backend should now be running on `http://localhost:5000`.

## Google Sheets Synchronization

The application automatically syncs donor data from Google Sheets into the local SQLite database on every startup. This ensures data persistence across deployments.

## API Endpoints

- **GET** `/health`: Check if the server is active.
- **POST** `/api/donors`: Register a new donor.
- **GET** `/api/donations/count`: Retrieve the total number of registered donors.
- **GET** `/api/public/donors`: Search for donors (public).
- **GET** `/api/admin/donors`: Retrieve and manage donors (requires admin token).
- **GET** `/api/admin/export`: Download donor data as CSV (requires admin token).

## Connecting Frontend

The frontend is already configured to communicate with this backend. Ensure both are running simultaneously for registration to work.
