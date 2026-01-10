import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function runMigration() {
    let connection;

    try {
        // Create connection
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('✅ Connected to database');

        // Check if column exists
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'approvals' AND COLUMN_NAME = 'end_date'`,
            [process.env.DB_NAME]
        );

        if (columns.length > 0) {
            console.log('ℹ️  Column end_date already exists in approvals table');
        } else {
            // Add the column
            await connection.query(
                `ALTER TABLE approvals 
                 ADD COLUMN end_date DATE NULL AFTER transaction_to`
            );
            console.log('✅ Successfully added end_date column to approvals table');
        }

        // Verify the column was added
        const [verify] = await connection.query(
            `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'approvals' AND COLUMN_NAME = 'end_date'`,
            [process.env.DB_NAME]
        );

        if (verify.length > 0) {
            console.log('✅ Verification successful:');
            console.log('   Column:', verify[0].COLUMN_NAME);
            console.log('   Type:', verify[0].DATA_TYPE);
            console.log('   Nullable:', verify[0].IS_NULLABLE);
        }

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('✅ Database connection closed');
        }
    }
}

runMigration();
