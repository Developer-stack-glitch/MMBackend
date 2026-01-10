import { pool } from "../config/dbconfig.js";

/**
 * Create calendar_events table
 */
async function createCalendarEventsTable() {
    // First, try to create table without foreign key
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS calendar_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            event_date DATE NOT NULL,
            notes TEXT,
            category VARCHAR(100) DEFAULT 'general',
            alert_sent TINYINT(1) DEFAULT 0,
            is_deleted TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_event_date (event_date),
            INDEX idx_alert_sent (alert_sent),
            INDEX idx_is_deleted (is_deleted)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    try {
        await pool.query(createTableQuery);
        console.log("✅ calendar_events table created successfully");

        // Try to add foreign key constraint if users table exists
        try {
            await pool.query(`
                ALTER TABLE calendar_events 
                ADD CONSTRAINT fk_calendar_user 
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            `);
            console.log("✅ Foreign key constraint added");
        } catch (fkError) {
            console.log("ℹ️  Foreign key constraint not added (users table may not exist or constraint already exists)");
        }

        return true;
    } catch (error) {
        console.error("❌ Error creating calendar_events table:", error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run migration
console.log("Starting calendar events migration...");
createCalendarEventsTable()
    .then(() => {
        console.log("✅ Migration completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    });




