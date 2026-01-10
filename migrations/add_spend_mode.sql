-- Add spend_mode column to expenses table
ALTER TABLE expenses 
ADD COLUMN spend_mode VARCHAR(50) NULL AFTER end_date;

-- Add spend_mode column to approvals table
ALTER TABLE approvals 
ADD COLUMN spend_mode VARCHAR(50) NULL AFTER end_date;
