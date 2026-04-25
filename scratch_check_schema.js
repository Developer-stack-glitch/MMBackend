import { pool } from "./config/dbconfig.js";

async function checkSchema() {
    try {
        const [rows] = await pool.query("SHOW COLUMNS FROM approvals");
        console.log("Approvals columns:", rows.map(r => r.Field));
        
        const [rows2] = await pool.query("SHOW COLUMNS FROM expenses");
        console.log("Expenses columns:", rows2.map(r => r.Field));
    } catch (err) {
        console.error("Error checking schema:", err);
    } finally {
        process.exit();
    }
}

checkSchema();
