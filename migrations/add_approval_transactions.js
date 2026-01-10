import { pool } from "../config/dbconfig.js";

const runMigration = async () => {
    try {
        console.log("Running migration...");

        // Add transaction_from and transaction_to to approvals
        await pool.query(`
            ALTER TABLE approvals 
            ADD COLUMN transaction_from VARCHAR(255) NULL,
            ADD COLUMN transaction_to VARCHAR(255) NULL
        `);

        console.log("Migration successful");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
};

runMigration();
