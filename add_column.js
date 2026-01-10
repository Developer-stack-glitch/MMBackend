import { pool } from './config/dbconfig.js';

async function run() {
    try {
        // Check if column exists strictly if needed, or just try ADD (MySQL will error if exists usually, or we can handle it)
        // Simple approach: Try to add it.
        await pool.query("ALTER TABLE approvals ADD COLUMN is_edit TINYINT(1) DEFAULT 0");
        console.log("Column is_edit added successfully.");
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Column is_edit already exists.");
        } else {
            console.error("Error adding column:", e);
        }
    }
    process.exit();
}

run();
