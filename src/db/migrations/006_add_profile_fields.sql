-- AutoGradeX Database Schema
-- Migration 005: Add profile fields
-- PostgreSQL 15+

-- Add profile fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS institution TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS office_hours TEXT;

-- Add major to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS major TEXT;
