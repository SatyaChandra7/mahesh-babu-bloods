-- ============================================================
-- MAHESH BABU BLOODS - SUPABASE POSTGRESQL SCHEMA
-- Execute this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ============================================================

-- 1. Create Donors Table
CREATE TABLE IF NOT EXISTS "Donors" (
  "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "fullName" VARCHAR(255) NOT NULL,
  "dateOfBirth" DATE,
  "gender" VARCHAR(50),
  "weight" VARCHAR(50),
  "phoneNumber" VARCHAR(50) NOT NULL,
  "bloodGroup" VARCHAR(10) NOT NULL,
  "state" VARCHAR(100),
  "district" VARCHAR(100),
  "mandal" VARCHAR(100),
  "village" VARCHAR(100),
  "pincode" VARCHAR(20),
  "registeredAt" TIMESTAMPTZ DEFAULT NOW(),
  "isVerified" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Feedbacks Table
CREATE TABLE IF NOT EXISTS "Feedbacks" (
  "id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" >= 1 AND "rating" <= 5),
  "comment" TEXT NOT NULL,
  "isApproved" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Performance Indexes
CREATE INDEX IF NOT EXISTS "idx_donors_phone" ON "Donors" ("phoneNumber");
CREATE INDEX IF NOT EXISTS "idx_donors_blood_group" ON "Donors" ("bloodGroup");
CREATE INDEX IF NOT EXISTS "idx_donors_location" ON "Donors" ("state", "district");

-- 4. Enable Row Level Security (RLS)
ALTER TABLE "Donors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Feedbacks" ENABLE ROW LEVEL SECURITY;

-- 5. Create Security Policies
-- Donors Policies
DROP POLICY IF EXISTS "Allow public read on Donors" ON "Donors";
CREATE POLICY "Allow public read on Donors" 
  ON "Donors" 
  FOR SELECT 
  TO anon, authenticated 
  USING (true);

DROP POLICY IF EXISTS "Allow public insert on Donors" ON "Donors";
CREATE POLICY "Allow public insert on Donors" 
  ON "Donors" 
  FOR INSERT 
  TO anon, authenticated 
  WITH CHECK (true);

-- Feedbacks Policies
DROP POLICY IF EXISTS "Allow public read on Feedbacks" ON "Feedbacks";
CREATE POLICY "Allow public read on Feedbacks" 
  ON "Feedbacks" 
  FOR SELECT 
  TO anon, authenticated 
  USING (true);

DROP POLICY IF EXISTS "Allow public insert on Feedbacks" ON "Feedbacks";
CREATE POLICY "Allow public insert on Feedbacks" 
  ON "Feedbacks" 
  FOR INSERT 
  TO anon, authenticated 
  WITH CHECK (true);

-- 6. Grant Role Permissions for Data API
GRANT ALL ON TABLE "Donors" TO anon, authenticated, service_role;
GRANT ALL ON TABLE "Feedbacks" TO anon, authenticated, service_role;
