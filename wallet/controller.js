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
    const startDate = req.query.startDate || req.query.start_date;
    const endDate = req.query.endDate || req.query.end_date;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
        let incomeParams = [userId];
        let expenseParams = [userId];
        let dateFilter = "";

        if (startDate && endDate) {
            // Using DATE() to ensure comparison works even with timestamp columns
            dateFilter = " AND DATE(date) >= DATE(?) AND DATE(date) <= DATE(?)";
            incomeParams.push(startDate, endDate);
            expenseParams.push(startDate, endDate);
        }

        // 1. Income from wallet
        const [[incomeRow]] = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) AS income 
             FROM wallet 
             WHERE user_id = ? AND type = 'income'${dateFilter}`,
            incomeParams
        );

        // 2. Expense from expenses table
        const [[expenseRow]] = await pool.query(
            `SELECT COALESCE(SUM(total), 0) AS expense 
             FROM expenses 
             WHERE user_id = ?${dateFilter}`,
            expenseParams
        );

        // 3. Calculate Balance
        const totalIncome = parseFloat(incomeRow.income);
        const totalExpense = parseFloat(expenseRow.expense);
        const balance = totalIncome - totalExpense;

        // 4. Wallet entries (from wallet table) - FILTERED FOR INCOME ONLY AS PER USER REQUEST
        const [rows] = await pool.query(
            `SELECT id, user_id, name, role, category, categoryColor, amount, frequency,
                    main_category, sub_category, branch, date, type, color, icon, invoice,
                    gst, transaction_from, transaction_to, vendor_name, vendor_number, end_date, note
             FROM wallet 
             WHERE user_id = ? AND type = 'income'${dateFilter}
             ORDER BY date DESC, id DESC
             LIMIT ? OFFSET ?`,
            [...incomeParams, limit, offset]
        );

        // 5. Fetch count for pagination (only income as spend is hidden)
        const [[countRow]] = await pool.query(
            `SELECT COUNT(*) as total 
             FROM wallet 
             WHERE user_id = ? AND type = 'income'${dateFilter}`,
            incomeParams
        );
        const total = countRow.total;

        // 8. Send response in correct format
        res.json({
            entries: rows,
            total,
            page,
            limit,
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
             WHERE role != 'admin' AND role != 'superadmin'`
        );

        // For each user, calculate received, spend, and balance
        const walletDetails = await Promise.all(
            users.map(async (user) => {
                let incomeSql = `SELECT COALESCE(SUM(amount), 0) AS income FROM wallet WHERE user_id = ? AND type = 'income'`;
                let expenseSql = `SELECT COALESCE(SUM(total), 0) AS spend FROM expenses WHERE user_id = ?`;

                const queryParams = [user.id];

                if (start_date && end_date) {
                    incomeSql += ` AND DATE(date) >= DATE(?) AND DATE(date) <= DATE(?)`;
                    expenseSql += ` AND DATE(date) >= DATE(?) AND DATE(date) <= DATE(?)`; // utilizing date column in expenses
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

export const updateVendor = async (req, res) => {
    const { id } = req.params;
    const { name, number, company_name, gst, email, address } = req.body;

    if (!name) return res.status(400).json({ message: "Vendor name is required" });

    try {
        const [result] = await pool.query(
            "UPDATE vendors SET name = ?, number = ?, company_name = ?, gst = ?, email = ?, address = ? WHERE id = ?",
            [name, number, company_name, gst, email, address, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        res.json({ message: "Vendor updated successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

export const deleteVendor = async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query("DELETE FROM vendors WHERE id = ?", [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        res.json({ message: "Vendor deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};

