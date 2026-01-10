ALTER TABLE wallet
ADD COLUMN vendor_name VARCHAR(255) NULL AFTER transaction_to,
ADD COLUMN vendor_number VARCHAR(50) NULL AFTER vendor_name;
