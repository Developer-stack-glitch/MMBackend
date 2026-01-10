import { pool } from "../config/dbconfig.js";

/**
 * Add status column to calendar_events table
 */
async function addStatusColumn() {
    try {
        // Add status column
        await pool.query(`
            ALTER TABLE calendar_events 
            ADD COLUMN status ENUM('pending', 'completed', 'overdue') DEFAULT 'pending' AFTER category
        `);

        console.log("✅ Status column added successfully");

        // Add index for better performance
        await pool.query(`
            ALTER TABLE calendar_events 
            ADD INDEX idx_status (status)
        `);

        console.log("✅ Status index added successfully");

        return true;
    } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
            console.log("ℹ️  Status column already exists");
            return true;
        }
        console.error("❌ Error adding status column:", error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run migration
console.log("Starting status column migration...");
addStatusColumn()
    .then(() => {
        console.log("✅ Migration completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    });
