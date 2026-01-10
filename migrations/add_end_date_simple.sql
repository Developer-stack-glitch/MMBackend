-- Simple migration to add end_date column to approvals table
ALTER TABLE approvals 
ADD COLUMN IF NOT EXISTS end_date DATE NULL AFTER transaction_to;
