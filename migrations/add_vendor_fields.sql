-- Add vendor_name, vendor_number, and end_date columns to expenses table
ALTER TABLE expenses 
ADD COLUMN vendor_name VARCHAR(255) NULL AFTER invoice,
ADD COLUMN vendor_number INT(50) NULL AFTER vendor_name,
ADD COLUMN end_date DATE NULL AFTER vendor_number;

-- Add vendor_name, vendor_number, and end_date columns to approvals table
ALTER TABLE approvals 
ADD COLUMN vendor_name VARCHAR(255) NULL AFTER invoice,
ADD COLUMN vendor_number INT(50) NULL AFTER vendor_name,
ADD COLUMN end_date DATE NULL AFTER vendor_number;
