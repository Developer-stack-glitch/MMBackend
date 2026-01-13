import { pool } from "../config/dbconfig.js";

// ================= ADD WALLET ENTRY =================
// ================= ADD WALLET ENTRY =================
export const addWallet = async (req, res) => {
    const { amount, date, user_id, branch, note } = req.body;

    if (!amount || !date || !user_id) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        await pool.query(
            `INSERT INTO wallet (user_id, amount, type, date, branch, note) VALUES (?, ?, 'income', ?, ?, ?)`,
            [user_id, amount, date, branch, note]
        );

        res.json({ message: "Wallet amount added successfully" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};



// ================= GET WALLET ENTRIES =================
export const getWalletEntries = async (req, res) => {
    const { userId } = req.params;

    try {
        // 1. Income from wallet
        const [[incomeRow]] = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) AS income 
             FROM wallet 
             WHERE user_id = ? AND type = 'income'`,
            [userId]
        );

        // 2. Expense from expenses table (column: total)
        const [[expenseRow]] = await pool.query(
            `SELECT COALESCE(SUM(total), 0) AS expense 
             FROM expenses 
             WHERE user_id = ?`,
            [userId]
        );

        // 3. Calculate Balance
        const totalIncome = parseFloat(incomeRow.income);
        const totalExpense = parseFloat(expenseRow.expense);
        const balance = totalIncome - totalExpense;

        // 4. Wallet entries (from wallet table)
        const [rows] = await pool.query(
            `SELECT id, user_id, name, role, category, categoryColor, amount, frequency,
                    main_category, sub_category, branch, date, type, color, icon, invoice,
                    gst, transaction_from, transaction_to, vendor_name, vendor_number, end_date, note
             FROM wallet 
             WHERE user_id = ?`,
            [userId]
        );

        // 5. Fetch expenses from expenses table
        const [expenseRows] = await pool.query(
            `SELECT id, user_id, NULL as name, 'User' as role, sub_category as category, color as categoryColor, total as amount, 'Once' as frequency,
                    main_category, sub_category, branch, date, 'expense' as type, color, icon, invoice,
                    gst, transaction_from, transaction_to, vendor_name, vendor_number, NULL as end_date, description as note
             FROM expenses 
             WHERE user_id = ?`,
            [userId]
        );

        // 6. Merge and Sort
        const allEntries = [...rows, ...expenseRows].sort((a, b) => new Date(b.date) - new Date(a.date));

        // 7. Send response in correct format
        res.json({
            entries: allEntries,
            wallet: balance,
            income: totalIncome,
            expense: totalExpense,
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};

export const getWalletPaginated = async (req, res) => {
    try {
        const userId = req.params.userId;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Total count
        const [[countRow]] = await pool.query(
            `SELECT COUNT(*) AS total FROM wallet WHERE user_id = ?`,
            [userId]
        );

        const total = countRow.total;
        const totalPages = Math.ceil(total / limit);

        // Paginated data – 🔧 FIXED FIELDS
        const [rows] = await pool.query(
            `
            SELECT id, user_id, name, role, category, categoryColor, amount, frequency,
                   main_category, sub_category, branch, date, type, color, icon, invoice,
                   gst, transaction_from, transaction_to, vendor_name, vendor_number, end_date, note
            FROM wallet 
            WHERE user_id = ?
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
            `,
            [userId, limit, offset]
        );

        res.json({
            page,
            limit,
            total,
            totalPages,
            entries: rows,
        });

    } catch (err) {
        console.error("Error fetching wallet logs:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// ================= GET ALL WALLET DETAILS =================
export const getAllWalletDetails = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // Get all users (excluding admin)
        const [users] = await pool.query(
            `SELECT id, name, email, role 
             FROM users 
             WHERE role != 'admin'`
        );

        // For each user, calculate received, spend, and balance
        const walletDetails = await Promise.all(
            users.map(async (user) => {
                let incomeSql = `SELECT COALESCE(SUM(amount), 0) AS income FROM wallet WHERE user_id = ? AND type = 'income'`;
                let expenseSql = `SELECT COALESCE(SUM(total), 0) AS spend FROM expenses WHERE user_id = ?`;

                const queryParams = [user.id];

                if (start_date && end_date) {
                    incomeSql += ` AND date >= ? AND date <= ?`;
                    expenseSql += ` AND date >= ? AND date <= ?`; // utilizing date column in expenses
                    queryParams.push(start_date, end_date);
                }

                // 1. Get total received (wallet type='income')
                const [[incomeRow]] = await pool.query(incomeSql, queryParams);

                // 2. Get total spend (expenses table)
                const [[spendRow]] = await pool.query(expenseSql, queryParams);

                const received = parseFloat(incomeRow.income);
                const spend = parseFloat(spendRow.spend);
                const balance = received - spend;

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    received,
                    spend,
                    balance
                };
            })
        );

        res.json(walletDetails);

    } catch (err) {
        console.error("Error fetching wallet details:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// ================= GET ALL WALLET TRANSACTIONS (ADMIN) =================
export const getAllWalletTransactions = async (req, res) => {
    try {
        // Fetch all wallet entries
        const [rows] = await pool.query(
            `SELECT id, user_id, name, role, category, categoryColor, amount, frequency,
                    main_category, sub_category, branch, date, type, color, icon, invoice,
                    gst, transaction_from, transaction_to, vendor_name, vendor_number, end_date, note
             FROM wallet 
             ORDER BY date DESC`
        );

        res.json({ entries: rows });

    } catch (err) {
        console.error("Error fetching all wallet transactions:", err);
        res.status(500).json({ message: "Server error" });
    }
};

// ================= VENDORS =================
export const getVendors = async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM vendors ORDER BY name ASC");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

export const addVendor = async (req, res) => {
    const { name, number, company_name, gst, email, address } = req.body;
    if (!name) return res.status(400).json({ message: "Vendor name is required" });
    try {
        await pool.query(
            "INSERT INTO vendors (name, number, company_name, gst, email, address) VALUES (?, ?, ?, ?, ?, ?)",
            [name, number, company_name, gst, email, address]
        );
        res.json({ message: "Vendor added successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

