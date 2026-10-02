import { pool as db } from './config/dbconfig.js';

async function run() {
    try {
        await db.query("ALTER TABLE bank_transaction_actions ADD COLUMN cr_dr VARCHAR(10) DEFAULT NULL AFTER transaction_date");
        console.log("Altered bank_transaction_actions");
    } catch (e) {
        console.log("Error altering bank_transaction_actions:", e.message);
    }
    
    try {
        await db.query("ALTER TABLE cash_transaction_actions ADD COLUMN cr_dr VARCHAR(10) DEFAULT NULL AFTER transaction_date");
        console.log("Altered cash_transaction_actions");
    } catch (e) {
        console.log("Error altering cash_transaction_actions:", e.message);
    }

    try {
        const [bankCols] = await db.query("DESCRIBE bank_transactions");
        console.log("bank_transactions columns:", bankCols.map(c => c.Field).join(', '));
        
        const [cashCols] = await db.query("DESCRIBE cash_transactions");
        console.log("cash_transactions columns:", cashCols.map(c => c.Field).join(', '));
    } catch (e) {
        console.log("Error describing tables:", e.message);
    }
    
    process.exit(0);
}

run();
