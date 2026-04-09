import { pool } from "../config/dbconfig.js";
import { getIO } from "../socket.js";
import fs from "fs";
import csv from "csv-parser";
import xlsx from "xlsx";

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

        let icon = cat[0]?.icon || null;
        let color = cat[0]?.color || null;

        // ✅ AUTO-ADD CATEGORY IF MISSING
        if (!cat.length || !icon) {
            icon = "Receipt";
            color = "#d4af37";
            try {
                await pool.query(
                    `INSERT IGNORE INTO expense_category (main_category, sub_category, icon, color) 
                     VALUES (?, ?, ?, ?)`,
                    [mainCategory, subCategory, icon, color]
                );
            } catch (catErr) {
                console.error("Error auto-adding category manual:", catErr);
            }
        }

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

// ================= BULK UPLOAD EXPENSES =================
export const bulkUploadExpenses = async (req, res) => {
    if (!req.files || !req.files.length) {
        return res.status(400).json({ message: "No file uploaded" });
    }

    const userId = req.user.id;
    const uploadedFile = req.files.find(f =>
        f.originalname.toLowerCase().endsWith(".csv") ||
        f.originalname.toLowerCase().endsWith(".xlsx") ||
        f.originalname.toLowerCase().endsWith(".xls")
    );

    if (!uploadedFile) {
        return res.status(400).json({ message: "No CSV or Excel file found among uploads" });
    }

    const isExcel = uploadedFile.originalname.toLowerCase().endsWith(".xlsx") ||
        uploadedFile.originalname.toLowerCase().endsWith(".xls");

    // Map original filenames to stored filenames for images
    const imageMap = {};
    req.files.forEach(f => {
        const ext = f.originalname.toLowerCase().split('.').pop();
        if (!["csv", "xlsx", "xls"].includes(ext)) {
            imageMap[f.originalname.toLowerCase()] = `/uploads/invoices/${f.filename}`;
        }
    });

    let results = [];
    const filePath = uploadedFile.path;

    // Helper: format date from DD-MM-YYYY to YYYY-MM-DD
    const formatDate = (dateStr) => {
        if (!dateStr) return null;

        // Handle Excel numeric date serials
        if (typeof dateStr === 'number') {
            const date = new Date((dateStr - 25569) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }

        if (typeof dateStr !== 'string') dateStr = String(dateStr);

        // If it's already YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.split('T')[0];
        // If it's DD-MM-YYYY or DD/MM/YYYY
        const parts = dateStr.split(/[-/]/);
        if (parts.length === 3) {
            // Assume DD-MM-YYYY if 1st part is day, 3rd is year
            if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            // Assume YYYY-MM-DD if 1st part is year
            if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
        return dateStr;
    };

    try {
        // Fetch all categories to cache icons and colors
        const [categories] = await pool.query("SELECT main_category, sub_category, icon, color FROM expense_category");
        const categoryMap = {};
        categories.forEach(cat => {
            const key = `${cat.main_category.trim().toLowerCase()}|${cat.sub_category.trim().toLowerCase()}`;
            categoryMap[key] = { icon: cat.icon, color: cat.color };
        });

        if (isExcel) {
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        } else {
            const stream = fs.createReadStream(filePath).pipe(csv());
            for await (const row of stream) {
                results.push(row);
            }
        }

        let successCount = 0;
        let errors = [];

        for (let i = 0; i < results.length; i++) {
            const row = results[i];
            const {
                Date: rawDate,
                Branch,
                Total,
                MainCategory,
                SubCategory,
                Description,
                SpendMode,
                GST,
                TransactionFrom,
                TransactionTo,
                VendorNumber,
                VendorGST,
                Invoice: invoiceValue // Filename from file
            } = row;

            if (!rawDate || !Branch || !Total || !MainCategory || !SubCategory) {
                errors.push(`Row ${i + 1}: Required fields missing`);
                continue;
            }

            const cleanMain = String(MainCategory).trim();
            const cleanSub = String(SubCategory).trim();
            const catKey = `${cleanMain.toLowerCase()}|${cleanSub.toLowerCase()}`;

            let icon = categoryMap[catKey]?.icon || "Receipt";
            let color = categoryMap[catKey]?.color || "#d4af37";

            // ✅ AUTOMATICALLY ADD NEW CATEGORY
            if (!categoryMap[catKey]) {
                try {
                    await pool.query(
                        `INSERT IGNORE INTO expense_category (main_category, sub_category, icon, color) 
                         VALUES (?, ?, ?, ?)`,
                        [cleanMain, cleanSub, icon, color]
                    );
                    categoryMap[catKey] = { icon, color };
                    console.log(`Auto-added new category: ${cleanMain} > ${cleanSub}`);
                } catch (catErr) {
                    console.error("Error auto-adding category:", catErr);
                }
            }

            try {
                const formattedDate = formatDate(rawDate);
                // Try matching the invoice filename from the uploaded files
                let invoiceJson = null;
                const invFileName = String(invoiceValue || "").toLowerCase();
                if (invoiceValue && imageMap[invFileName]) {
                    invoiceJson = JSON.stringify([imageMap[invFileName]]);
                } else if (invoiceValue && String(invoiceValue).startsWith("http")) { // Support URLs too
                    invoiceJson = JSON.stringify([invoiceValue]);
                }

                await pool.query(
                    `INSERT INTO expenses 
                     (user_id, branch, date, total, main_category, sub_category, description, 
                      icon, color, invoice, spend_mode, gst, status,
                      transaction_from, transaction_to, vendor_name, vendor_number, vendor_gst)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        Branch,
                        formattedDate,
                        Total,
                        cleanMain,
                        cleanSub,
                        Description || null,
                        icon,
                        color,
                        invoiceJson,
                        SpendMode || null,
                        GST || "No",
                        TransactionFrom || null,
                        TransactionTo || null,
                        TransactionTo || null, // vendor_name
                        VendorNumber || null,
                        VendorGST || null
                    ]
                );
                successCount++;
            } catch (insErr) {
                console.error(`Row ${i + 1} insert error:`, insErr.message);
                errors.push(`Row ${i + 1}: ${insErr.message}`);
            }
        }

        // Clean up data file, leave images
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        if (successCount === 0 && results.length > 0) {
            return res.status(400).json({
                message: "Bulk upload failed. No records added.",
                errors: errors.slice(0, 5)
            });
        }

        res.json({
            message: `${successCount} expenses uploaded successfully!`,
            errors: errors.length > 0 ? errors.slice(0, 5) : []
        });

    } catch (err) {
        console.error("Bulk upload processing error:", err);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ message: "Server error during bulk processing" });
    }
};

// ================= DOWNLOAD EXPENSE TEMPLATE =================
export const downloadExpenseTemplate = (req, res) => {
    const headers = [
        "Date",
        "Branch",
        "Total",
        "MainCategory",
        "SubCategory",
        "Description",
        "SpendMode",
        "GST",
        "TransactionFrom",
        "TransactionTo",
        "VendorNumber",
        "VendorGST",
        "Invoice"
    ];

    const sampleRow = [
        "2023-10-27",
        "Chennai",
        "1500",
        "Office Supplies",
        "Stationery",
        "Bulk purchase of pens and papers",
        "UPI",
        "No",
        "Prakash Kotak",
        "Amazon",
        "",
        "",
        "invoice_sample.png"
    ];

    const csvContent = [
        headers.join(","),
        sampleRow.join(",")
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=expense_template.csv");
    res.status(200).send(csvContent);
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

        let icon = cat[0]?.icon || null;
        let color = cat[0]?.color || null;

        // ✅ AUTO-ADD CATEGORY IF MISSING
        if (!cat.length || !icon) {
            icon = "Receipt";
            color = "#d4af37";
            try {
                await pool.query(
                    `INSERT IGNORE INTO expense_category (main_category, sub_category, icon, color) 
                     VALUES (?, ?, ?, ?)`,
                    [mainCategory, subCategory, icon, color]
                );
            } catch (catErr) {
                console.error("Error auto-adding category manual approval:", catErr);
            }
        }

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

        // Notify admins about new approval
        const io = getIO();
        io.emit("newApproval", {
            message: "A new approval request has been submitted",
            user_id,
            userName
        });

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

        let icon = cat[0]?.icon || null;
        let color = cat[0]?.color || null;

        // ✅ AUTO-ADD CATEGORY IF MISSING
        if (!cat.length || !icon) {
            icon = "TrendingUp";
            color = "#006b29ff";
            try {
                await pool.query(
                    `INSERT IGNORE INTO income_category (category_name, icon, color) 
                     VALUES (?, ?, ?)`,
                    [mainCategory, icon, color]
                );
            } catch (catErr) {
                console.error("Error auto-adding income category manual:", catErr);
            }
        }

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
        const [[count]] = await pool.query(countSql, (role !== "admin" && role !== "superadmin") ? [userId] : []);

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
        const { startDate, endDate } = req.query;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (role !== "admin" && role !== "superadmin") {
            whereConditions.push("i.user_id = ?");
            params.push(userId);
        }

        if (startDate && endDate) {
            whereConditions.push("i.date >= ? AND i.date <= ?");
            params.push(startDate, endDate);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

        const sql = `
            SELECT 
                i.id, i.user_id, u.name AS user_name, i.branch, i.date, i.total,
                i.category, i.description, i.invoice, i.icon, i.color
            FROM incomes i
            LEFT JOIN users u ON u.id = i.user_id
            ${whereClause}
            ORDER BY i.date DESC, i.id DESC
            LIMIT ? OFFSET ?`;

        const totalParams = [...params, limit, offset];
        const [rows] = await pool.query(sql, totalParams);

        const parsedRows = rows.map((row) => ({
            ...row,
            invoice: parseInvoiceData(row.invoice)
        }));

        const countSql = `SELECT COUNT(*) AS total FROM incomes i ${whereClause}`;
        const [[count]] = await pool.query(countSql, params);

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

        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const nameFilter = req.query.name;
        const branchFilter = req.query.branch;
        const transactionFilter = req.query.transaction;

        let query = `SELECT * FROM approvals WHERE status='pending'`;
        let countQuery = `SELECT COUNT(*) as total FROM approvals WHERE status='pending'`;
        let params = [];

        if (String(role).toLowerCase() !== 'admin' && String(role).toLowerCase() !== 'superadmin') {
            query += ` AND user_id = ?`;
            countQuery += ` AND user_id = ?`;
            params.push(userId);
        }

        if (nameFilter && nameFilter !== 'All') {
            query += ` AND name = ?`;
            countQuery += ` AND name = ?`;
            params.push(nameFilter);
        }

        if (branchFilter && branchFilter !== 'All') {
            query += ` AND branch = ?`;
            countQuery += ` AND branch = ?`;
            params.push(branchFilter);
        }

        if (transactionFilter && transactionFilter !== 'All') {
            query += ` AND transaction_from = ?`;
            countQuery += ` AND transaction_from = ?`;
            params.push(transactionFilter);
        }

        if (startDate && endDate) {
            query += ` AND date >= ? AND date <= ?`;
            countQuery += ` AND date >= ? AND date <= ?`;
            params.push(startDate, endDate);
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
        }

        // Notify user about approval status change
        const io = getIO();
        io.emit("approvalUpdated", {
            id,
            status: 'approved',
            user_id: request.user_id
        });

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

        // Notify user about rejection (though in this code it's deleted)
        const io = getIO();
        io.emit("approvalUpdated", {
            id,
            status: 'rejected'
        });

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

            if (requesterRole !== "admin" && requesterRole !== "superadmin") {
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
            const isElevated = requesterRole === "admin" || requesterRole === "superadmin";
            const newStatus = isElevated ? 'approved' : 'pending';
            const newIsEdit = isElevated ? 0 : 1;

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

            if (isElevated) {
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
        if (requesterRole !== "admin" && requesterRole !== "superadmin") {
            query += ` AND user_id=?`;
            params.push(requesterId);
        }

        const [[exp]] = await pool.query(query, params);

        // 2. If not found in expenses, check if it's a pending expense in approvals table (Legacy Fallback)
        if (!exp) {
            // Check approvals table for pending expense
            let approvalQuery = `SELECT * FROM approvals WHERE id=?`;
            let approvalParams = [expense_id];

            if (requesterRole !== "admin" && requesterRole !== "superadmin") {
                approvalQuery += ` AND user_id=?`;
                approvalParams.push(requesterId);
            }

            const [[approval]] = await pool.query(approvalQuery, approvalParams);

            if (!approval) {
                return res.status(404).json({ message: "Not found" });
            }

            const isElevated = requesterRole === "admin" || requesterRole === "superadmin";
            const newStatus = isElevated ? 'approved' : 'pending';
            const isEditFlag = isElevated ? 0 : 1;

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

            if (isElevated) {
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
        if (requesterRole === "admin" || requesterRole === "superadmin") {
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

        const nameFilter = req.query.name;
        const branchFilter = req.query.branch;
        const transactionFilter = req.query.transaction;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

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
             LEFT JOIN users u ON e.user_id = u.id
             WHERE 1=1`;

        let approvalsCountQuery = `SELECT COUNT(*) as total FROM approvals WHERE status = 'approved'`;
        let expensesCountQuery = `SELECT COUNT(*) as total FROM expenses e LEFT JOIN users u ON e.user_id = u.id WHERE 1=1`;

        let params = [];

        // 1. Role Filter
        if (String(userRole).toLowerCase() !== 'admin' && String(userRole).toLowerCase() !== 'superadmin') {
            approvalsQuery += ` AND user_id = ?`;
            expensesQuery += ` AND e.user_id = ?`;
            approvalsCountQuery += ` AND user_id = ?`;
            expensesCountQuery += ` AND e.user_id = ?`;
            params.push(userId);
        }

        // 2. Name Filter
        if (nameFilter && nameFilter !== 'All') {
            approvalsQuery += ` AND name = ?`;
            expensesQuery += ` AND u.name = ?`;
            approvalsCountQuery += ` AND name = ?`;
            expensesCountQuery += ` AND u.name = ?`;
            params.push(nameFilter);
        }

        // 3. Branch Filter
        if (branchFilter && branchFilter !== 'All') {
            approvalsQuery += ` AND branch = ?`;
            expensesQuery += ` AND e.branch = ?`;
            approvalsCountQuery += ` AND branch = ?`;
            expensesCountQuery += ` AND e.branch = ?`;
            params.push(branchFilter);
        }

        // 4. Transaction Filter
        if (transactionFilter && transactionFilter !== 'All') {
            approvalsQuery += ` AND transaction_from = ?`;
            expensesQuery += ` AND e.transaction_from = ?`;
            approvalsCountQuery += ` AND transaction_from = ?`;
            expensesCountQuery += ` AND e.transaction_from = ?`;
            params.push(transactionFilter);
        }

        if (startDate && endDate) {
            approvalsQuery += ` AND date >= ? AND date <= ?`;
            expensesQuery += ` AND e.date >= ? AND e.date <= ?`;
            approvalsCountQuery += ` AND date >= ? AND date <= ?`;
            expensesCountQuery += ` AND e.date >= ? AND e.date <= ?`;
            params.push(startDate, endDate);
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

export const getExpensesTotalStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        const { startDate, endDate, name, branch, transaction } = req.query;

        let expWhere = "WHERE 1=1";
        let appWhere = "WHERE 1=1";
        let paramsExp = [];
        let paramsApp = [];

        if (String(role).toLowerCase() !== 'admin' && String(role).toLowerCase() !== 'superadmin') {
            expWhere += " AND e.user_id = ?";
            appWhere += " AND user_id = ?";
            paramsExp.push(userId);
            paramsApp.push(userId);
        }

        if (name && name !== 'All') {
            expWhere += " AND u.name = ?";
            appWhere += " AND name = ?";
            paramsExp.push(name);
            paramsApp.push(name);
        }

        if (branch && branch !== 'All') {
            expWhere += " AND e.branch = ?";
            appWhere += " AND branch = ?";
            paramsExp.push(branch);
            paramsApp.push(branch);
        }

        if (transaction && transaction !== 'All') {
            expWhere += " AND e.transaction_from = ?";
            appWhere += " AND transaction_from = ?";
            paramsExp.push(transaction);
            paramsApp.push(transaction);
        }

        if (startDate && endDate) {
            expWhere += " AND e.date >= ? AND e.date <= ?";
            appWhere += " AND date >= ? AND date <= ?";
            paramsExp.push(startDate, endDate);
            paramsApp.push(startDate, endDate);
        }

        // Sum Expenses
        const expSql = `
            SELECT SUM(e.total) AS totalExpense
            FROM expenses e
            LEFT JOIN users u ON u.id = e.user_id
            ${expWhere}`;
        const [[expResult]] = await pool.query(expSql, paramsExp);

        // Sum Approvals (only approved ones)
        const appSql = `
            SELECT SUM(amount) AS totalApproved
            FROM approvals
            ${appWhere} AND status = 'approved'`;
        const [[appResult]] = await pool.query(appSql, paramsApp);

        return res.json({
            totalExpense: expResult.totalExpense || 0,
            totalApproved: appResult.totalApproved || 0
        });

    } catch (err) {
        console.error("Error in getExpensesTotalStats:", err);
        res.status(500).json({ message: "Server Error" });
    }
};


export const getTransactionFilterOptions = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        let params = [];
        let whereExp = "";
        let whereApp = "";

        if (String(userRole).toLowerCase() !== 'admin' && String(userRole).toLowerCase() !== 'superadmin') {
            whereExp = "WHERE user_id = ?";
            whereApp = "WHERE user_id = ?";
            params = [userId];
        }

        // Get unique branches
        const [expBranches] = await pool.query(`SELECT DISTINCT branch FROM expenses ${whereExp}`, params);
        const [appBranches] = await pool.query(`SELECT DISTINCT branch FROM approvals ${whereApp}`, params);

        const allBranches = [
            ...expBranches.map(b => b.branch),
            ...appBranches.map(b => b.branch)
        ].filter(Boolean);
        const uniqueBranches = [...new Set(allBranches)];

        // Get unique transaction sources
        const [expSources] = await pool.query(`SELECT DISTINCT transaction_from FROM expenses ${whereExp}`, params);
        const [appSources] = await pool.query(`SELECT DISTINCT transaction_from FROM approvals ${whereApp}`, params);

        const allSources = [
            ...expSources.map(s => s.transaction_from),
            ...appSources.map(s => s.transaction_from)
        ].filter(Boolean);
        const uniqueSources = [...new Set(allSources)];

        // Get Names
        let uniqueNames = [];
        if (String(userRole).toLowerCase() === 'admin' || String(userRole).toLowerCase() === 'superadmin') {
            // Get all users
            const [users] = await pool.query(`SELECT name FROM users`);
            uniqueNames = users.map(u => u.name).filter(Boolean);
        } else {
            const [[usr]] = await pool.query(`SELECT name FROM users WHERE id=?`, [userId]);
            uniqueNames = [usr?.name].filter(Boolean);
        }

        return res.json({
            branches: uniqueBranches,
            names: uniqueNames,
            transactionSources: uniqueSources
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
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
        if (userRole !== 'admin' && userRole !== 'superadmin' && expense.user_id !== userId) {
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

/* -------------------------------------------------------
   EDIT INCOME
---------------------------------------------------------*/
export const editIncome = async (req, res) => {
    let { income_id, updates } = req.body;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;

    try {
        if (typeof updates === 'string') {
            updates = JSON.parse(updates);
        }

        const [[income]] = await pool.query(`SELECT * FROM incomes WHERE id = ?`, [income_id]);
        if (!income) {
            return res.status(404).json({ message: "Income not found" });
        }

        if (requesterRole !== 'admin' && requesterRole !== 'superadmin' && income.user_id !== requesterId) {
            return res.status(403).json({ message: "Not authorized" });
        }

        const invoicePaths = req.files ? req.files.map(file => `/uploads/invoices/${file.filename}`) : [];
        let existingInvoices = [];
        if (updates.existingInvoices) {
            try {
                existingInvoices = JSON.parse(updates.existingInvoices);
            } catch (e) {
                existingInvoices = [];
            }
        }
        const allInvoices = [...existingInvoices, ...invoicePaths];
        const invoiceJson = allInvoices.length > 0 ? JSON.stringify(allInvoices) : null;

        const [cat] = await pool.query(
            `SELECT icon, color FROM income_category WHERE category_name = ? LIMIT 1`,
            [updates.mainCategory]
        );
        const icon = cat[0]?.icon || income.icon;
        const color = cat[0]?.color || income.color;

        await pool.query(
            `UPDATE incomes SET 
                branch=?, date=?, total=?, category=?, description=?, invoice=?, icon=?, color=?
             WHERE id=?`,
            [
                updates.branch,
                updates.date,
                updates.total,
                updates.mainCategory,
                updates.description || null,
                invoiceJson,
                icon,
                color,
                income_id
            ]
        );

        return res.json({ message: "Income updated successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

/* -------------------------------------------------------
   DELETE INCOME
---------------------------------------------------------*/
export const deleteIncome = async (req, res) => {
    const { id } = req.params;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;

    try {
        const [[income]] = await pool.query(`SELECT * FROM incomes WHERE id = ?`, [id]);
        if (!income) {
            return res.status(404).json({ message: "Income not found" });
        }

        if (requesterRole !== 'admin' && requesterRole !== 'superadmin' && income.user_id !== requesterId) {
            return res.status(403).json({ message: "Not authorized" });
        }

        await pool.query(`DELETE FROM incomes WHERE id = ?`, [id]);
        return res.json({ message: "Income deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

/* -------------------------------------------------------
   DASHBOARD APIS (Optimized)
---------------------------------------------------------*/

// 1. Stats endpoint
export const getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const { startDate, endDate, prevStartDate, prevEndDate } = req.query;

        const getTotals = async (start, end) => {
            let expWhere = "WHERE 1=1";
            let walletWhere = "WHERE type = 'income'";
            let paramsExp = [];
            let paramsWallet = [];

            if (role !== 'admin' && role !== 'superadmin') {
                expWhere += " AND user_id = ?";
                walletWhere += " AND user_id = ?";
                paramsExp.push(userId);
                paramsWallet.push(userId);
            }

            if (start && end) {
                expWhere += " AND date >= ? AND date <= ?";
                walletWhere += " AND date >= ? AND date <= ?";
                paramsExp.push(start, end);
                paramsWallet.push(start, end);
            }

            const [[exp]] = await pool.query(`SELECT SUM(total) as total FROM expenses ${expWhere}`, paramsExp);
            const [[wallet]] = await pool.query(`SELECT SUM(amount) as total FROM wallet ${walletWhere}`, paramsWallet);

            const expense = Number(exp.total || 0);
            const income = Number(wallet.total || 0);

            return { expense, income, balance: income - expense };
        };

        const current = await getTotals(startDate, endDate);
        const previous = await getTotals(prevStartDate, prevEndDate);

        res.json({ current, previous });
    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// 2. Charts endpoint
export const getDashboardCharts = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const { startDate, endDate } = req.query;

        let where = "WHERE 1=1";
        let params = [];
        if (role !== 'admin' && role !== 'superadmin') {
            where += " AND user_id = ?";
            params.push(userId);
        }
        if (startDate && endDate) {
            where += " AND date >= ? AND date <= ?";
            params.push(startDate, endDate);
        }

        // 1. Wallet Cash Flow Data (Income grouped by month)
        const [walletData] = await pool.query(
            `SELECT DATE_FORMAT(date, '%b') as month, SUM(amount) as value 
             FROM wallet ${where.replace('1=1', 'type = \'income\'')} 
             GROUP BY month ORDER BY MIN(date) DESC`, params);

        // 2. Expense Category Breakdown
        const [expenseData] = await pool.query(
            `SELECT sub_category as name, SUM(total) as value 
             FROM expenses ${where} 
             GROUP BY sub_category ORDER BY value DESC`, params);

        res.json({ walletData, expenseData });
    } catch (err) {
        console.error("Dashboard Charts Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// 3. Recent Transactions endpoint
export const getRecentTransactions = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        let expWhere = "WHERE 1=1";
        let walletWhere = "WHERE type = 'income'";
        let paramsExp = [];
        let paramsWallet = [];

        if (role !== 'admin' && role !== 'superadmin') {
            expWhere += " AND e.user_id = ?";
            walletWhere += " AND user_id = ?";
            paramsExp.push(userId);
            paramsWallet.push(userId);
        }

        const [expenses] = await pool.query(
            `SELECT 'Expense' as type, e.date, e.total as amount, e.sub_category as category, e.branch, e.invoice as method, e.description, u.name as user_name 
             FROM expenses e LEFT JOIN users u ON e.user_id = u.id ${expWhere} 
             ORDER BY e.date DESC, e.id DESC LIMIT 5`, paramsExp);

        const [approvals] = await pool.query(
            `SELECT 'Wallet' as type, date, amount, sub_category as category, branch, invoice as method, note as description, name as user_name 
             FROM wallet ${walletWhere} 
             ORDER BY date DESC, id DESC LIMIT 5`, paramsWallet);

        res.json({ expenses, approvals });
    } catch (err) {
        console.error("Dashboard Recent Transactions Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

