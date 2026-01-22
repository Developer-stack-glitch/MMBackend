import { pool } from "../config/dbconfig.js";

// Helper function to safely parse invoice data
const parseInvoiceData = (invoiceString) => {
    if (!invoiceString) return null;

    if (typeof invoiceString !== 'string') return invoiceString;

    try {
        const parsed = JSON.parse(invoiceString);
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
    } catch (e) {
        return [invoiceString];
    }
};

export const addExpense = async (req, res) => {
    const {
        user_id,
        branch,
        date,
        total,
        mainCategory,
        subCategory,
        description,
        spend_mode,
        gst,
        transaction_from,
        transaction_to,
        vendor_name,
        vendor_number
    } = req.body;

    if (!branch || !date || !total || !mainCategory || !subCategory) {
        return res.status(400).json({ message: "Required fields missing" });
    }

    try {
        const [cat] = await pool.query(
            `SELECT icon, color FROM expense_category 
             WHERE main_category = ? AND sub_category = ? LIMIT 1`,
            [mainCategory, subCategory]
        );

        const icon = cat[0]?.icon || null;
        const color = cat[0]?.color || null;

        // Get uploaded file paths from multer
        const invoicePaths = req.files ? req.files.map(file => `/uploads/invoices/${file.filename}`) : [];
        const invoiceJson = invoicePaths.length > 0 ? JSON.stringify(invoicePaths) : null;

        await pool.query(
            `INSERT INTO expenses 
                 (user_id, branch, date, total, main_category, sub_category, description, 
                  icon, color, invoice, spend_mode, gst, status,
                  transaction_from, transaction_to, vendor_name, vendor_number, vendor_gst)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
            [
                user_id,
                branch,
                date,
                total,
                mainCategory,
                subCategory,
                description || null,
                icon,
                color,
                invoiceJson,
                spend_mode || null,
                gst || "No",
                transaction_from || null,
                transaction_to || null,
                vendor_name || null,
                vendor_number || null,
                req.body.vendor_gst || null
            ]
        );

        return res.json({ message: "Expense added successfully!" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};

/* -------------------------------------------------------
   ADD APPROVAL (User)
---------------------------------------------------------*/
export const addApproval = async (req, res) => {
    const {
        user_id,
        branch,
        date,
        total,
        mainCategory,
        subCategory,
        description,
        gst,
        transaction_from,
        end_date
    } = req.body;

    if (!branch || !date || !total || !mainCategory || !subCategory) {
        return res.status(400).json({ message: "Required fields missing" });
    }


    try {
        // Get user name
        const [[usr]] = await pool.query(
            `SELECT name FROM users WHERE id = ? LIMIT 1`,
            [user_id]
        );
        const userName = usr?.name || "Unknown";

        // Get icon & color
        const [cat] = await pool.query(
            `SELECT icon, color FROM expense_category 
             WHERE main_category = ? AND sub_category = ? LIMIT 1`,
            [mainCategory, subCategory]
        );

        const icon = cat[0]?.icon || null;
        const color = cat[0]?.color || null;

        // Get uploaded file paths from multer
        const invoicePaths = req.files ? req.files.map(file => `/uploads/invoices/${file.filename}`) : [];
        const invoiceJson = invoicePaths.length > 0 ? JSON.stringify(invoicePaths) : null;

        await pool.query(
            `INSERT INTO approvals
             (user_id, name, role, category, categoryColor, amount, frequency, 
              main_category, sub_category, branch, date, status, color, icon, invoice,
              gst, original_expense_id, transaction_from, end_date)
             VALUES (?, ?, ?, ?, ?, ?, 'Once', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, ?, ?)`,
            [
                user_id,
                userName,
                description || null, // role
                subCategory,         // category
                color,               // categoryColor
                total,               // amount
                mainCategory,        // main_category
                subCategory,         // sub_category
                branch,              // branch
                date,                // date
                color,               // color
                icon,                // icon
                invoiceJson,         // invoice
                gst || "No",         // gst
                transaction_from || null,
                end_date || null     // end_date
            ]
        );

        return res.json({ message: "Approval request sent!" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};


/* -------------------------------------------------------
   ADD INCOME
---------------------------------------------------------*/
export const addIncome = async (req, res) => {
    const { user_id, branch, date, total, mainCategory, description } = req.body;

    if (!branch || !date || !total || !mainCategory) {
        return res.status(400).json({ message: "Required fields missing" });
    }

    try {
        const [cat] = await pool.query(
            `SELECT icon, color FROM income_category WHERE category_name = ? LIMIT 1`,
            [mainCategory]
        );

        const icon = cat[0]?.icon || null;
        const color = cat[0]?.color || null;

        // Get uploaded file paths from multer
        const invoicePaths = req.files ? req.files.map(file => `/uploads/invoices/${file.filename}`) : [];
        const invoiceJson = invoicePaths.length > 0 ? JSON.stringify(invoicePaths) : null;

        await pool.query(
            `INSERT INTO incomes 
             (user_id, branch, date, total, category, description, invoice, icon, color)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user_id,
                branch,
                date,
                total,
                mainCategory,
                description || null,
                invoiceJson,
                icon,
                color
            ]
        );

        return res.json({ message: "Income added successfully" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};
/* -------------------------------------------------------
   GET ALL EXPENSES (Paginated)
---------------------------------------------------------*/
export const getAllExpenses = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let where = "";
        let params = [];

        if (role === "user") {
            where = "WHERE e.user_id = ?";
            params.push(userId);
        }

        const sql = `
            SELECT 
                e.id, e.user_id, u.name AS user_name, e.branch, e.date, e.total,
                e.main_category, e.sub_category, e.description, e.invoice,
                e.icon, e.color, 
                e.spend_mode, e.gst, e.status, e.vendor_name, e.vendor_number, e.vendor_gst
            FROM expenses e
            LEFT JOIN users u ON u.id = e.user_id
            ${where}
            ORDER BY e.date DESC, e.id DESC
            LIMIT ?, ?`;

        params.push(offset, limit);

        const [rows] = await pool.query(sql, params);

        const parsedRows = rows.map((row) => ({
            ...row,
            invoice: parseInvoiceData(row.invoice)
        }));

        const countSql = `SELECT COUNT(*) AS total FROM expenses e ${where}`;
        const [[count]] = await pool.query(countSql, role === "user" ? [userId] : []);

        return res.json({
            data: parsedRows,
            total: count.total,
            page,
            limit
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

/* -------------------------------------------------------
   GET ALL INCOME (Paginated)
---------------------------------------------------------*/
export const getAllIncome = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let where = "";
        let params = [];

        if (role === "user") {
            where = "WHERE i.user_id = ?";
            params.push(userId);
        }

        const sql = `
            SELECT 
                i.id, i.user_id, u.name AS user_name, i.branch, i.date, i.total,
                i.category, i.description, i.invoice, i.icon, i.color
            FROM incomes i
            LEFT JOIN users u ON u.id = i.user_id
            ${where}
            ORDER BY i.date DESC, i.id DESC
            LIMIT ? OFFSET ?`;

        params.push(limit, offset);

        const [rows] = await pool.query(sql, params);

        const parsedRows = rows.map((row) => ({
            ...row,
            invoice: parseInvoiceData(row.invoice)
        }));

        const countSql = `SELECT COUNT(*) AS total FROM incomes i ${where}`;
        const [[count]] = await pool.query(countSql, role === "user" ? [userId] : []);

        return res.json({
            data: parsedRows,
            total: count.total,
            page,
            limit
        });

    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

export const getExpensesPaginated = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const userId = req.user.id;
        const role = req.user.role;

        let where = "";
        let params = [];

        if (role === "user") {
            where = "WHERE e.user_id = ?";
            params.push(userId);
        }

        // 1️⃣ Total Count
        const [[countRow]] = await pool.query(
            `SELECT COUNT(*) as total FROM expenses e ${where}`,
            params
        );
        const total = countRow.total;
        const totalPages = Math.ceil(total / limit);

        // 2️⃣ Paginated Data
        const [rows] = await pool.query(
            `
            SELECT 
                e.id, e.user_id, u.name AS user_name,
                e.branch, e.date, e.total,
                e.main_category, e.sub_category, 
                e.description, e.invoice, e.icon, e.color,
                e.spend_mode, e.gst, e.vendor_name, e.vendor_number, e.vendor_gst
            FROM expenses e
            LEFT JOIN users u ON u.id = e.user_id
            ${where}
            ORDER BY e.date DESC, e.id DESC
            LIMIT ? OFFSET ?
            `,
            [...params, limit, offset]
        );

        // Parse invoice JSON strings back to arrays
        const parsedRows = rows.map(row => ({
            ...row,
            invoice: parseInvoiceData(row.invoice)
        }));

        res.json({
            page,
            limit,
            total,
            totalPages,
            data: parsedRows
        });

    } catch (err) {
        console.error("Error getting paginated expenses:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const getIncomePaginated = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const userId = req.user.id;
        const role = req.user.role;

        let where = "";
        let params = [];

        if (role === "user") {
            where = "WHERE i.user_id = ?";
            params.push(userId);
        }

        // 1️⃣ Count
        const [[countRow]] = await pool.query(
            `SELECT COUNT(*) as total FROM incomes i ${where}`,
            params
        );
        const total = countRow.total;
        const totalPages = Math.ceil(total / limit);

        // 2️⃣ Paginated Data
        const [rows] = await pool.query(
            `
            SELECT 
                i.id, i.user_id, u.name AS user_name,
                i.branch, i.date, i.total,
                i.category, i.description,
                i.invoice, i.icon, i.color
            FROM incomes i
            LEFT JOIN users u ON u.id = i.user_id
            ${where}
            ORDER BY i.date DESC, i.id DESC
            LIMIT ? OFFSET ?
            `,
            [...params, limit, offset]
        );

        // Parse invoice JSON strings back to arrays
        const parsedRows = rows.map(row => ({
            ...row,
            invoice: parseInvoiceData(row.invoice)
        }));

        res.json({
            page,
            limit,
            total,
            totalPages,
            data: parsedRows
        });

    } catch (err) {
        console.error("Error getting paginated income:", err);
        res.status(500).json({ message: "Server error" });
    }
};

export const getSummary = async (req, res) => {
    try {
        const today = new Date();

        // ✅ THIS MONTH RANGE
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

        // ✅ LAST MONTH RANGE
        const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const startOfThisMonth = startOfMonth;

        const thisMonthStartSQL = startOfMonth.toISOString().slice(0, 10);
        const nextMonthStartSQL = startOfNextMonth.toISOString().slice(0, 10);

        const lastMonthStartSQL = startOfLastMonth.toISOString().slice(0, 10);
        const thisMonthStartSQL2 = startOfThisMonth.toISOString().slice(0, 10);

        // ✅ THIS MONTH
        const [thisInc] = await pool.query(
            `SELECT SUM(total) AS total FROM incomes WHERE date >= ? AND date < ?`,
            [thisMonthStartSQL, nextMonthStartSQL]
        );
        const [thisExp] = await pool.query(
            `SELECT SUM(total) AS total FROM expenses WHERE date >= ? AND date < ?`,
            [thisMonthStartSQL, nextMonthStartSQL]
        );

        // ✅ LAST MONTH
        const [lastInc] = await pool.query(
            `SELECT SUM(total) AS total FROM incomes WHERE date >= ? AND date < ?`,
            [lastMonthStartSQL, thisMonthStartSQL2]
        );
        const [lastExp] = await pool.query(
            `SELECT SUM(total) AS total FROM expenses WHERE date >= ? AND date < ?`,
            [lastMonthStartSQL, thisMonthStartSQL2]
        );

        const thisMonthIncome = Number(thisInc[0]?.total || 0);
        const thisMonthExpenses = Number(thisExp[0]?.total || 0);

        const lastMonthIncome = Number(lastInc[0]?.total || 0);
        const lastMonthExpenses = Number(lastExp[0]?.total || 0);
        const lastMonthBalance = (lastMonthIncome || 0) - (lastMonthExpenses || 0);

        res.json({
            income: thisMonthIncome,
            expenses: thisMonthExpenses,
            balance: thisMonthIncome - thisMonthExpenses,

            lastMonthIncome,
            lastMonthExpenses,
            lastMonthBalance
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
};


export const getLastMonthSummary = async (req, res) => {
    try {
        const { date } = req.query;

        if (!date)
            return res.status(400).json({ message: "Date is required" });

        // ✅ Convert date to month start & next month start
        const selected = new Date(date);
        const startOfMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
        const startOfNextMonth = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);

        const startSQL = startOfMonth.toISOString().slice(0, 10);
        const nextSQL = startOfNextMonth.toISOString().slice(0, 10);

        // ✅ Income for selected month
        const [incomeResult] = await pool.query(
            `SELECT SUM(total) AS total FROM incomes 
             WHERE date >= ? AND date < ?`,
            [startSQL, nextSQL]
        );

        // ✅ Expenses for selected month
        const [expenseResult] = await pool.query(
            `SELECT SUM(total) AS total FROM expenses 
             WHERE date >= ? AND date < ?`,
            [startSQL, nextSQL]
        );

        const income = Number(incomeResult[0]?.total || 0);
        const expenses = Number(expenseResult[0]?.total || 0);

        return res.json({
            monthStart: startSQL,
            monthEnd: nextSQL,
            income,
            expenses,
            balance: income - expenses,
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
};

/* -------------------------------------------------------
   GET PENDING APPROVALS
---------------------------------------------------------*/
export const getApprovals = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let query = `SELECT * FROM approvals WHERE status='pending'`;
        let countQuery = `SELECT COUNT(*) as total FROM approvals WHERE status='pending'`;
        let params = [];

        if (String(role).toLowerCase() !== 'admin') {
            query += ` AND user_id = ?`;
            countQuery += ` AND user_id = ?`;
            params.push(userId);
        }

        query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;

        const [rows] = await pool.query(query, [...params, limit, offset]);
        const [[countResult]] = await pool.query(countQuery, params);

        res.json({
            data: rows,
            total: countResult.total,
            page,
            limit
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

/* -------------------------------------------------------
   APPROVE EXPENSE
---------------------------------------------------------*/
export const approveExpense = async (req, res) => {
    const { id } = req.body;

    try {
        const [[request]] = await pool.query(
            `SELECT * FROM approvals WHERE id=?`,
            [id]
        );

        if (!request) return res.status(404).json({ message: "Request not found" });

        // Update status to approved in approvals table
        await pool.query(
            `UPDATE approvals SET status='approved' WHERE id=?`,
            [id]
        );

        // CHECK IF WALLET ENTRY ALREADY EXISTS FOR THIS APPROVAL
        const [[existingWallet]] = await pool.query(`SELECT id FROM wallet WHERE approval_id=?`, [id]);

        if (existingWallet) {
            // UPDATE EXISTING WALLET ENTRY
            await pool.query(
                `UPDATE wallet SET 
                    user_id=?, name=?, role=?, category=?, categoryColor=?, amount=?, frequency=?, 
                    main_category=?, sub_category=?, branch=?, date=?, type='income', color=?, icon=?, invoice=?,
                    gst=?, transaction_from=?, transaction_to=?, vendor_name=?, vendor_number=?, vendor_gst=?, end_date=?, note=?
                 WHERE id=?`,
                [
                    request.user_id,
                    request.name,
                    request.role,
                    request.category,
                    request.categoryColor,
                    request.amount,
                    request.frequency || 'Once',
                    request.main_category,
                    request.sub_category,
                    request.branch,
                    request.date,
                    request.color,
                    request.icon,
                    request.invoice,
                    request.gst,
                    request.transaction_from,
                    request.transaction_to,
                    request.vendor_name,
                    request.vendor_number,
                    request.vendor_gst,
                    request.end_date,
                    request.role || "Approved Expense",
                    existingWallet.id
                ]
            );
            return res.json({ message: "Approved expense updated in wallet!" });
        } else {
            // INSERT NEW WALLET ENTRY with approval_id
            await pool.query(
                `INSERT INTO wallet 
                 (user_id, name, role, category, categoryColor, amount, frequency, 
                  main_category, sub_category, branch, date, type, color, icon, invoice,
                  gst, transaction_from, transaction_to, vendor_name, vendor_number, vendor_gst, end_date, note, approval_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'income', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    request.user_id,
                    request.name,
                    request.role,
                    request.category,
                    request.categoryColor,
                    request.amount,
                    request.frequency || 'Once',
                    request.main_category,
                    request.sub_category,
                    request.branch,
                    request.date,
                    request.color,
                    request.icon,
                    request.invoice,
                    request.gst,
                    request.transaction_from,
                    request.transaction_to,
                    request.vendor_name,
                    request.vendor_number,
                    request.vendor_gst,
                    request.end_date,
                    request.role || "Approved Expense",
                    id
                ]
            );
            return res.json({ message: "Approved successfully and added to wallet!" });
        }

        return res.json({ message: "Approved successfully and added to wallet!" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

/* -------------------------------------------------------
   REJECT EXPENSE
---------------------------------------------------------*/
export const rejectExpense = async (req, res) => {
    const { id } = req.body;

    try {
        const [result] = await pool.query(
            `DELETE FROM approvals WHERE id=?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Request not found" });
        }

        return res.json({ message: "Request rejected successfully!" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};


/* -------------------------------------------------------
   EDIT EXPENSE (User)
---------------------------------------------------------*/
export const editExpense = async (req, res) => {
    let { expense_id, updates } = req.body;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    let requesterName = req.user.name;

    if (!requesterName) {
        const [[usr]] = await pool.query(`SELECT name FROM users WHERE id = ?`, [requesterId]);
        requesterName = usr?.name || "Unknown";
    }

    try {
        // Parse updates if it's a JSON string (from FormData)
        if (typeof updates === 'string') {
            try {
                updates = JSON.parse(updates);
            } catch (e) {
                return res.status(400).json({ message: "Invalid updates format" });
            }
        }
        // Get uploaded file paths from multer
        const invoicePaths = req.files ? req.files.map(file => `/uploads/invoices/${file.filename}`) : [];

        // Parse existing invoices from updates if provided
        let existingInvoices = [];
        if (updates.existingInvoices) {
            try {
                existingInvoices = JSON.parse(updates.existingInvoices);
            } catch (e) {
                existingInvoices = [];
            }
        }

        // Combine existing and new invoices
        const allInvoices = [...existingInvoices, ...invoicePaths];
        const invoiceJson = allInvoices.length > 0 ? JSON.stringify(allInvoices) : null;

        const sourceType = updates.source_type || 'expense';

        // --------------------------------------------------------------------------------
        // BLOCK A: EDITING AN APPROVAL DIRECTLY (e.g. from Approval Tab)
        // --------------------------------------------------------------------------------
        if (sourceType === 'approval') {
            let approvalQuery = `SELECT * FROM approvals WHERE id=?`;
            let approvalParams = [expense_id];

            if (requesterRole !== "admin") {
                approvalQuery += ` AND user_id=?`;
                approvalParams.push(requesterId);
            }

            const [[approval]] = await pool.query(approvalQuery, approvalParams);

            if (!approval) {
                return res.status(404).json({ message: "Approval request not found" });
            }

            // Determine status based on role
            // If Admin edits: Auto-approve (or keep approved) and sync wallet.
            // If User edits: Revert to pending, remove from wallet.
            const isAdm = requesterRole === "admin";
            const newStatus = isAdm ? 'approved' : 'pending';
            const newIsEdit = isAdm ? 0 : 1;

            // Fetch latest icon/color for the category (in case category changed)
            const [cat] = await pool.query(
                `SELECT icon, color FROM expense_category 
                 WHERE main_category = ? AND sub_category = ? LIMIT 1`,
                [updates.mainCategory, updates.subCategory]
            );
            const icon = cat[0]?.icon || approval.icon;
            const color = cat[0]?.color || approval.color;

            // Update the approval record
            await pool.query(
                `UPDATE approvals SET 
                    amount=?, branch=?, date=?, main_category=?, sub_category=?, 
                    role=?, invoice=?, 
                    gst=?, transaction_from=?, end_date=?,
                    status=?,
                    is_edit=?,
                    icon=?, color=?, category=?, categoryColor=?
                 WHERE id=?`,
                [
                    updates.total,
                    updates.branch,
                    updates.date,
                    updates.mainCategory,
                    updates.subCategory,
                    updates.description,
                    invoiceJson,
                    updates.gst,
                    updates.transaction_from || null,
                    updates.end_date || null,
                    newStatus,
                    newIsEdit,
                    icon, color, updates.subCategory, color, // category=subCategory, categoryColor=color
                    expense_id
                ]
            );

            if (isAdm) {
                // SYNC WITH WALLET (Upsert)
                const [[existingWallet]] = await pool.query(`SELECT id FROM wallet WHERE approval_id=?`, [expense_id]);

                if (existingWallet) {
                    // Update existing wallet entry
                    await pool.query(
                        `UPDATE wallet SET 
                            amount=?, branch=?, date=?, main_category=?, sub_category=?, 
                            role=?, invoice=?, 
                            gst=?, transaction_from=?, end_date=?,
                            note=?,
                            color=?, icon=?, category=?, categoryColor=?
                         WHERE id=?`,
                        [
                            updates.total,
                            updates.branch,
                            updates.date,
                            updates.mainCategory,
                            updates.subCategory,
                            updates.description, // role/ note
                            invoiceJson,
                            updates.gst,
                            updates.transaction_from || null,
                            updates.end_date || null,
                            updates.description, // note gets description
                            color, icon, updates.subCategory, color,
                            existingWallet.id
                        ]
                    );
                } else {
                    // Insert new wallet entry
                    await pool.query(
                        `INSERT INTO wallet 
                         (user_id, name, role, category, categoryColor, amount, frequency, 
                          main_category, sub_category, branch, date, type, color, icon, invoice,
                          gst, transaction_from, transaction_to, vendor_name, vendor_number, vendor_gst, end_date, note, approval_id)
                         VALUES (?, ?, ?, ?, ?, ?, 'Once', ?, ?, ?, ?, 'income', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            approval.user_id,
                            approval.name,
                            updates.description, // role
                            updates.subCategory, // category
                            color,               // categoryColor
                            updates.total,       // amount
                            updates.mainCategory,
                            updates.subCategory,
                            updates.branch,
                            updates.date,
                            color,
                            icon,
                            invoiceJson,
                            updates.gst,
                            updates.transaction_from || null,
                            approval.transaction_to, // Keep original vendor info if not updated? Updates usually don't have this?
                            approval.vendor_name,
                            approval.vendor_number,
                            approval.vendor_gst,
                            updates.end_date || null,
                            updates.description, // note
                            expense_id
                        ]
                    );
                }
                return res.json({ message: "Approval updated and synced!" });

            } else {
                // Access to wallet: Remove from wallet if it exists (since it is now pending)
                await pool.query(`DELETE FROM wallet WHERE approval_id=?`, [expense_id]);
                return res.json({ message: "Approval request updated (pending re-approval)!" });
            }
        }

        // --------------------------------------------------------------------------------
        // BLOCK B: EDITING AN EXPENSE (e.g. from Expense Tab or Legacy)
        // --------------------------------------------------------------------------------
        // 1. Try to find the expense in the expenses table first
        let query = `SELECT * FROM expenses WHERE id=?`;
        let params = [expense_id];

        // If not admin, ensure they own the expense
        if (requesterRole !== "admin") {
            query += ` AND user_id=?`;
            params.push(requesterId);
        }

        const [[exp]] = await pool.query(query, params);

        // 2. If not found in expenses, check if it's a pending expense in approvals table (Legacy Fallback)
        if (!exp) {
            // Check approvals table for pending expense
            let approvalQuery = `SELECT * FROM approvals WHERE id=?`;
            let approvalParams = [expense_id];

            if (requesterRole !== "admin") {
                approvalQuery += ` AND user_id=?`;
                approvalParams.push(requesterId);
            }

            const [[approval]] = await pool.query(approvalQuery, approvalParams);

            if (!approval) {
                return res.status(404).json({ message: "Not found" });
            }

            const isAdm = requesterRole === "admin";
            const newStatus = isAdm ? 'approved' : 'pending';
            const isEditFlag = isAdm ? 0 : 1;

            // Update the expense in approvals table
            await pool.query(
                `UPDATE approvals SET 
                    amount=?, branch=?, date=?, main_category=?, sub_category=?, 
                    role=?, invoice=?, 
                    gst=?, transaction_from=?, end_date=?,
                    status=?,
                    is_edit=?
                 WHERE id=?`,
                [
                    updates.total,
                    updates.branch,
                    updates.date,
                    updates.mainCategory,
                    updates.subCategory,
                    updates.description,
                    invoiceJson,
                    updates.gst,
                    updates.transaction_from || null,
                    updates.end_date || null,
                    newStatus,
                    isEditFlag,
                    expense_id
                ]
            );

            if (isAdm) {
                // Upsert into EXPENSES table (The "Wallet Update" user refers to is expenses logic)
                // Check if we already have an original_expense_id
                let origExpId = approval.original_expense_id;

                if (origExpId) {
                    await pool.query(
                        `UPDATE expenses SET 
                            total=?, branch=?, date=?, main_category=?, sub_category=?, 
                            description=?, invoice=?, status='approved', spend_mode=?, gst=?,
                            transaction_from=?, transaction_to=?, vendor_name=?, vendor_number=?, vendor_gst=?
                         WHERE id=?`,
                        [
                            updates.total, updates.branch, updates.date, updates.mainCategory, updates.subCategory,
                            updates.description, invoiceJson, updates.spend_mode, updates.gst,
                            updates.transaction_from, approval.transaction_to, approval.vendor_name, approval.vendor_number, approval.vendor_gst,
                            origExpId
                        ]
                    );
                } else {
                    // Create new Expense
                    const [insRes] = await pool.query(
                        `INSERT INTO expenses 
                         (user_id, branch, date, total, main_category, sub_category, description, 
                          icon, color, invoice, spend_mode, gst, status,
                          transaction_from, transaction_to, vendor_name, vendor_number, vendor_gst)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
                        [
                            approval.user_id, updates.branch, updates.date, updates.total, updates.mainCategory, updates.subCategory, updates.description,
                            approval.icon, approval.color, invoiceJson, updates.spend_mode, updates.gst,
                            updates.transaction_from, approval.transaction_to, approval.vendor_name, approval.vendor_number, approval.vendor_gst
                        ]
                    );
                    origExpId = insRes.insertId;
                    // Link back
                    await pool.query('UPDATE approvals SET original_expense_id=? WHERE id=?', [origExpId, expense_id]);
                }

                // Cleanup wallet table if it was wrongly added there as income
                await pool.query('DELETE FROM wallet WHERE approval_id=?', [expense_id]);

                return res.json({ message: "Expense updated and approved!" });

            } else {
                // Non-admin: Remove from wallet if it exists (since it is now pending)
                await pool.query(`DELETE FROM wallet WHERE approval_id=?`, [expense_id]);
                return res.json({ message: "Pending expense updated!" });
            }
        }

        // 3. ADMIN: Update directly in expenses table
        if (requesterRole === "admin") {
            await pool.query(
                `UPDATE expenses SET 
                    total=?, branch=?, date=?, main_category=?, sub_category=?, 
                    description=?, invoice=?, 
                    spend_mode=?, gst=?, status='approved'
                 WHERE id=?`,
                [
                    updates.total, updates.branch, updates.date, updates.mainCategory, updates.subCategory,
                    updates.description, invoiceJson,
                    updates.spend_mode, updates.gst,
                    expense_id
                ]
            );

            // SYNC APPROVALS
            await pool.query(
                `UPDATE approvals SET 
                    amount=?, branch=?, date=?, main_category=?, sub_category=?, 
                    role=?, invoice=?, 
                    gst=?, transaction_from=?, end_date=?,
                    status='approved',
                    is_edit=0
                 WHERE original_expense_id=?`,
                [
                    updates.total, updates.branch, updates.date, updates.mainCategory, updates.subCategory,
                    updates.description, invoiceJson,
                    updates.gst, updates.transaction_from || null, updates.end_date || null,
                    expense_id
                ]
            );

            return res.json({ message: "Expense updated successfully!" });
        }

        /* ----------------------------------------
           CASE 1: Pending expense in expenses table → update approvals
        -----------------------------------------*/
        if (exp.status === "pending") {
            await pool.query(
                `UPDATE approvals SET 
                    amount=?, branch=?, date=?, main_category=?, sub_category=?, 
                    role=?, invoice=?, 
                    gst=?, transaction_from=?, end_date=?
                 WHERE original_expense_id=?`,
                [
                    updates.total,
                    updates.branch,
                    updates.date,
                    updates.mainCategory,
                    updates.subCategory,
                    updates.description,
                    invoiceJson,
                    updates.gst,
                    updates.transaction_from || null,
                    updates.end_date || null,
                    expense_id
                ]
            );

            return res.json({ message: "Pending expense updated!" });
        }

        return res.status(403).json({ message: "Action not allowed" });


    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};




export const getUserAllExpenses = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let approvalsQuery = `SELECT
                id,
                date,
                amount AS total,
                branch,
                main_category,
                sub_category,
                role AS description,
                gst,
                invoice,
                color,
                icon,
                status,
                transaction_from,
                end_date,
                name AS user_name,
                is_edit
             FROM approvals
             WHERE status = 'approved'`;

        let expensesQuery = `SELECT
                e.id, e.date, e.total, e.branch, e.main_category, e.sub_category, e.description,
                e.spend_mode, e.gst, e.invoice,
                e.color, e.icon,
                e.status, e.transaction_from, e.transaction_to, e.vendor_name, e.vendor_number, e.vendor_gst,
                u.name AS user_name
             FROM expenses e
             LEFT JOIN users u ON e.user_id = u.id`;

        // Counts
        let approvalsCountQuery = `SELECT COUNT(*) as total FROM approvals WHERE status = 'approved'`;
        let expensesCountQuery = `SELECT COUNT(*) as total FROM expenses e`;

        let params = [];

        if (String(userRole).toLowerCase() !== 'admin') {
            approvalsQuery += ` AND user_id = ?`;
            expensesQuery += ` WHERE e.user_id = ?`;
            approvalsCountQuery += ` AND user_id = ?`;
            expensesCountQuery += ` WHERE e.user_id = ?`;
            params = [userId];
        }

        approvalsQuery += ` ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`;
        expensesQuery += ` ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`;

        const [approvals] = await pool.query(approvalsQuery, [...params, limit, offset]);
        const [expenses] = await pool.query(expensesQuery, [...params, limit, offset]);

        const [[approvalsCount]] = await pool.query(approvalsCountQuery, params);
        const [[expensesCount]] = await pool.query(expensesCountQuery, params);

        return res.json({
            approvals: approvals,
            approvalsTotal: approvalsCount.total,
            expenses: expenses,
            expensesTotal: expensesCount.total,
            page,
            limit
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
};



/* -------------------------------------------------------
   DELETE EXPENSE
---------------------------------------------------------*/
export const deleteExpense = async (req, res) => {
    const { id } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    try {
        // 1. Check if expense exists
        const [[expense]] = await pool.query(`SELECT * FROM expenses WHERE id=?`, [id]);
        if (!expense) {
            return res.status(404).json({ message: "Expense not found" });
        }

        // 2. Permission check
        if (userRole !== 'admin' && expense.user_id !== userId) {
            return res.status(403).json({ message: "You are not authorized to delete this expense" });
        }

        // 3. Delete from expenses
        await pool.query(`DELETE FROM expenses WHERE id=?`, [id]);

        // 4. Also check if there is a linked approval (original_expense_id) and maybe reset it?
        // Or if this expense WAS an approval converted?
        // If an approval has original_expense_id = this id, we might want to nullify it or set status back to pending?
        // For now, let's just nullify the connection so it doesn't point to non-existent expense
        await pool.query(`UPDATE approvals SET original_expense_id=NULL, status='pending' WHERE original_expense_id=?`, [id]);

        return res.json({ message: "Expense deleted successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};
