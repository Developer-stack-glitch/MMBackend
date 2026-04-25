import { pool } from "./config/dbconfig.js";

async function runMigration() {
    try {
        console.log("Updating approvals table schema...");
        await pool.query(`
            ALTER TABLE approvals 
            ADD COLUMN vendor_name VARCHAR(255) DEFAULT NULL, 
            ADD COLUMN vendor_number VARCHAR(50) DEFAULT NULL, 
            ADD COLUMN vendor_gst VARCHAR(50) DEFAULT NULL, 
            ADD COLUMN transaction_to VARCHAR(255) DEFAULT NULL
        `);
        console.log("Approvals table updated successfully.");
    } catch (err) {
        if (err.code === 'ER_DUP_COLUMN_NAME') {
            console.log("Columns already exist.");
        } else {
            console.error("Error migrating table:", err);
        }
    } finally {
        process.exit();
    }
}

runMigration();
