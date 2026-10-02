import { pool } from './config/dbconfig.js';

async function run() {
    const tables = ['bank_transaction_actions', 'cash_transaction_actions', 'bank_transactions', 'cash_transactions', 'expenses', 'expense_category', 'branches', 'vendors', 'users'];
    for (const table of tables) {
        console.log(`\n--- ${table} ---`);
        try {
            const [rows] = await pool.query(`DESCRIBE ${table}`);
            console.log(rows.map(r => `${r.Field} (${r.Type})`).join('\n'));
        } catch(e) {
            console.log(`Table ${table} not found or error: ${e.message}`);
        }
    }
    process.exit();
}
run();
