import { pool } from './config/dbconfig.js';

async function run() {
    try {
        await pool.query("ALTER TABLE wallet ADD COLUMN approval_id INT DEFAULT NULL");
        console.log("Column approval_id added successfully.");
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Column approval_id already exists.");
        } else {
            console.error("Error adding column:", e);
        }
    }
    process.exit();
}

run();
