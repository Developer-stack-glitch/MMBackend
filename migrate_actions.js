import { pool } from './config/dbconfig.js';

async function migrate() {
    try {
        await pool.query(`
            ALTER TABLE bank_transaction_actions
            ADD COLUMN main_category VARCHAR(255) NULL,
            ADD COLUMN sub_category VARCHAR(255) NULL,
            ADD COLUMN branch VARCHAR(255) NULL,
            ADD COLUMN description TEXT NULL,
            ADD COLUMN spend_mode VARCHAR(50) NULL,
            ADD COLUMN vendor_name VARCHAR(255) NULL,
            ADD COLUMN vendor_type VARCHAR(50) NULL,
            ADD COLUMN gst VARCHAR(5) NULL,
            ADD COLUMN amount DECIMAL(15,2) NULL,
            ADD COLUMN transaction_date DATETIME NULL
        `);
        console.log("Migrated bank_transaction_actions");
    } catch (e) {
        console.log(e.message);
    }
    
    try {
        await pool.query(`
            ALTER TABLE cash_transaction_actions
            ADD COLUMN main_category VARCHAR(255) NULL,
            ADD COLUMN sub_category VARCHAR(255) NULL,
            ADD COLUMN branch VARCHAR(255) NULL,
            ADD COLUMN description TEXT NULL,
            ADD COLUMN spend_mode VARCHAR(50) NULL,
            ADD COLUMN vendor_name VARCHAR(255) NULL,
            ADD COLUMN vendor_type VARCHAR(50) NULL,
            ADD COLUMN gst VARCHAR(5) NULL,
            ADD COLUMN amount DECIMAL(15,2) NULL,
            ADD COLUMN transaction_date DATETIME NULL
        `);
        console.log("Migrated cash_transaction_actions");
    } catch (e) {
        console.log(e.message);
    }
    process.exit();
}
migrate();
