import { pool } from "../config/dbconfig.js";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";

// Helper to parse dates robustly
const parseExcelDate = (dateStr) => {
    if (!dateStr) return null;
    if (typeof dateStr === 'number') {
        return new Date(Math.round((dateStr - 25569) * 86400 * 1000));
    }
    if (dateStr instanceof Date) return dateStr;

    const cleanStr = dateStr.toString().trim().replace(/\//g, '-');

    // Match DD-MM-YYYY optionally with time
    const dmyMatch = cleanStr.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const month = parseInt(dmyMatch[2], 10) - 1;
        const year = parseInt(dmyMatch[3], 10);
        let time = dmyMatch[4] || '00:00:00';
        if (time.split(':').length === 2) time += ':00';
        const [h, m, s] = time.split(':').map(Number);
        return new Date(Date.UTC(year, month, day, h, m, s));
    }

    const d = new Date(cleanStr);
    return isNaN(d.getTime()) ? null : d;
};

const toMySQLDateTime = (date) => {
    if (!date) return null;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};

const toMySQLDate = (date) => {
    if (!date) return null;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const parseNumber = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const num = parseFloat(val.toString().replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
};

export const uploadCashStatement = async (req, res) => {
    const file = req.file;
    const userId = req.user?.id || null;

    if (!file) {
        return res.status(400).json({ success: false, message: "No Excel file provided." });
    }

    // Validate file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
        fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: "Invalid file type. Only .xlsx and .xls are allowed." });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Read Excel
        const workbook = xlsx.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

        if (rows.length === 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(400).json({ success: false, message: "Excel file is empty." });
        }

        // 2. Validate Columns
        const firstRow = rows[0];
        const requiredColumns = [
            "Date", "Sale Executive", "Stu Name", "Stu Number",
            "Course", "Purpose", "CR", "DR", "Balance",
            "Handover To", "Handover date"
        ];

        const missingColumns = requiredColumns.filter(col => !(col in firstRow));

        if (missingColumns.length > 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Missing required columns in Excel.",
                missing: missingColumns
            });
        }

        // 3. Parse rows
        const transactions = [];
        let minDate = null;
        let maxDate = null;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            const txnDateRaw = row["Date"];
            if (!txnDateRaw) continue; // Skip empty rows

            const txnDate = parseExcelDate(txnDateRaw);
            if (!txnDate) {
                fs.unlinkSync(file.path);
                connection.release();
                return res.status(400).json({ success: false, message: `Invalid Date at row ${i + 2}` });
            }

            if (!minDate || txnDate < minDate) minDate = txnDate;
            if (!maxDate || txnDate > maxDate) maxDate = txnDate;

            let handoverDate = null;
            if (row["Handover date"]) {
                const parsedHandover = parseExcelDate(row["Handover date"]);
                if (parsedHandover) {
                    handoverDate = toMySQLDate(parsedHandover);
                }
            }

            let crAmount = parseNumber(row["CR"]);
            let drAmount = parseNumber(row["DR"]);
            if (crAmount < 0) crAmount = 0;
            if (drAmount < 0) drAmount = 0;

            transactions.push({
                transaction_date: toMySQLDateTime(txnDate),
                sale_executive: (row["Sale Executive"] || "").toString().trim(),
                student_name: (row["Stu Name"] || "").toString().trim(),
                student_number: (row["Stu Number"] || "").toString().trim(),
                course: (row["Course"] || "").toString().trim(),
                purpose: (row["Purpose"] || "").toString().trim(),
                cr_amount: crAmount,
                dr_amount: drAmount,
                balance: parseNumber(row["Balance"]),
                handover_to: (row["Handover To"] || "").toString().trim(),
                handover_date: handoverDate
            });
        }

        if (transactions.length === 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(400).json({ success: false, message: "No valid transaction rows found." });
        }

        const statement_start_date = toMySQLDate(minDate);
        const statement_end_date = toMySQLDate(maxDate);

        // 4. Duplicate Protection
        const [existing] = await connection.query(`
            SELECT id FROM cash_statements 
            WHERE file_name = ? 
            AND statement_start_date = ? 
            AND statement_end_date = ?
        `, [file.originalname, statement_start_date, statement_end_date]);

        if (existing.length > 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(409).json({ success: false, message: "This cash statement has already been uploaded." });
        }

        // 5. Database Transaction
        await connection.beginTransaction();

        // Insert Statement
        const [stmtResult] = await connection.query(`
            INSERT INTO cash_statements (file_name, statement_start_date, statement_end_date, uploaded_by, uploaded_at)
            VALUES (?, ?, ?, ?, NOW())
        `, [file.originalname, statement_start_date, statement_end_date, userId]);

        const statement_id = stmtResult.insertId;

        // Insert Transactions
        const txnValues = transactions.map(t => [
            statement_id,
            t.transaction_date,
            t.sale_executive,
            t.student_name,
            t.student_number,
            t.course,
            t.purpose,
            t.cr_amount,
            t.dr_amount,
            t.balance,
            t.handover_to,
            t.handover_date,
            new Date(),
            new Date()
        ]);

        await connection.query(`
            INSERT INTO cash_transactions 
            (statement_id, transaction_date, sale_executive, student_name, student_number, course, purpose, cr_amount, dr_amount, balance, handover_to, handover_date, created_at, updated_at)
            VALUES ?
        `, [txnValues]);

        await connection.commit();
        connection.release();

        // Cleanup file
        fs.unlinkSync(file.path);

        return res.status(200).json({
            success: true,
            message: "Cash statement uploaded successfully",
            statement_id,
            file_name: file.originalname,
            statement_start_date,
            statement_end_date,
            transaction_count: transactions.length
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        if (file && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
        console.error("Upload Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error during upload." });
    }
};

export const getCashStatements = async (req, res) => {
    try {
        // Get transactions for all cash statements along with their actions
        const [rows] = await pool.query(`
            SELECT 
                ct.*,
                cta.id AS action_id,
                cta.purpose AS action_purpose,
                cta.created_by AS action_created_by,
                cta.created_at AS action_created_at,
                cta.updated_at AS action_updated_at,
                cta.main_category AS action_main_category,
                cta.sub_category AS action_sub_category,
                cta.branch AS action_branch,
                cta.description AS action_description,
                cta.spend_mode AS action_spend_mode,
                cta.vendor_name AS action_vendor_name,
                cta.vendor_type AS action_vendor_type,
                cta.gst AS action_gst,
                cta.cr_dr AS action_cr_dr
            FROM cash_transactions ct
            LEFT JOIN cash_transaction_actions cta 
                ON ct.id = cta.cash_transaction_id
            ORDER BY ct.transaction_date ASC, ct.id ASC
        `);

        // Map rows to construct the action object
        const transactions = rows.map(row => {
            let action = null;
            if (row.action_id) {
                action = {
                    id: row.action_id,
                    cash_transaction_id: row.id,
                    purpose: row.action_purpose,
                    main_category: row.action_main_category,
                    sub_category: row.action_sub_category,
                    branch: row.action_branch,
                    description: row.action_description,
                    spend_mode: row.action_spend_mode,
                    vendor_name: row.action_vendor_name,
                    vendor_type: row.action_vendor_type,
                    gst: row.action_gst,
                    cr_dr: row.action_cr_dr,
                    created_by: row.action_created_by,
                    created_at: row.action_created_at,
                    updated_at: row.action_updated_at
                };
            }

            const {
                action_id,
                action_purpose,
                action_created_by,
                action_created_at,
                action_updated_at,
                action_main_category,
                action_sub_category,
                action_branch,
                action_description,
                action_spend_mode,
                action_vendor_name,
                action_vendor_type,
                action_gst,
                action_cr_dr,
                ...transactionData
            } = row;

            return {
                ...transactionData,
                action
            };
        });

        return res.status(200).json({
            success: true,
            message: "Cash statement retrieved successfully",
            transaction_count: transactions.length,
            data: transactions
        });

    } catch (error) {
        console.error("Fetch Cash Statements Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const getCashStatementSummary = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: "start_date and end_date are required"
            });
        }

        // Opening balance = latest balance before selected start date
        const [openingRows] = await pool.query(`
            SELECT balance
            FROM cash_transactions
            WHERE transaction_date < ?
            ORDER BY transaction_date DESC, id DESC
            LIMIT 1
        `, [start_date]);

        const openingBalance = Number(openingRows[0]?.balance || 0);

        // Income = CR during selected period
        const [incomeRows] = await pool.query(`
            SELECT COALESCE(SUM(cr_amount), 0) AS income
            FROM cash_transactions
            WHERE transaction_date >= ?
              AND transaction_date < ?
        `, [start_date, end_date]);

        // Expenses = DR during selected period
        const [expenseRows] = await pool.query(`
            SELECT COALESCE(SUM(dr_amount), 0) AS expenses
            FROM cash_transactions
            WHERE transaction_date >= ?
              AND transaction_date < ?
        `, [start_date, end_date]);

        const income = Number(incomeRows[0]?.income || 0);
        const expenses = Number(expenseRows[0]?.expenses || 0);

        const balance = openingBalance + income - expenses;

        return res.status(200).json({
            success: true,
            data: {
                bank_name: "CASH",
                opening_balance: openingBalance,
                income,
                expenses,
                balance
            }
        });

    } catch (error) {
        console.error("Cash Summary Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};

// CASH TRANSACTION ACTION APIs 

export const createCashTransactionAction = async (req, res) => {
    try {
        const { 
            cash_transaction_id, 
            purpose, 
            main_category, 
            sub_category, 
            branch, 
            description, 
            spend_mode, 
            vendor_name, 
            vendor_type, 
            gst 
        } = req.body;
        const createdBy = req.user?.id || null;

        if (!cash_transaction_id) {
            return res.status(400).json({ success: false, message: "cash_transaction_id is required" });
        }

        if (!purpose || !purpose.trim()) {
            return res.status(400).json({ success: false, message: "Purpose is required" });
        }

        // Check transaction exists
        const [transaction] = await pool.query(
            `SELECT id, cr_amount, dr_amount, transaction_date FROM cash_transactions WHERE id = ? LIMIT 1`,
            [cash_transaction_id]
        );

        if (transaction.length === 0) {
            return res.status(404).json({ success: false, message: "Cash transaction not found" });
        }

        // Check action already exists
        const [existing] = await pool.query(
            `SELECT id FROM cash_transaction_actions WHERE cash_transaction_id = ? LIMIT 1`,
            [cash_transaction_id]
        );

        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: "This cash transaction already has an action." });
        }

        const txn = transaction[0];
        let originalAmount = 0;
        let cr_dr = null;
        if (Number(txn.dr_amount) > 0) {
            originalAmount = txn.dr_amount;
            cr_dr = 'Dr';
        } else if (Number(txn.cr_amount) > 0) {
            originalAmount = txn.cr_amount;
            cr_dr = 'Cr';
        }
        
        const originalDate = txn.transaction_date;

        const [result] = await pool.query(
            `INSERT INTO cash_transaction_actions
                (cash_transaction_id, purpose, main_category, sub_category, branch, description,
                 spend_mode, vendor_name, vendor_type, gst, amount, cr_dr, transaction_date, 
                 created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                cash_transaction_id, purpose.trim().substring(0, 255), main_category, sub_category, branch, description,
                spend_mode, vendor_name, vendor_type, gst, originalAmount, cr_dr, originalDate,
                createdBy
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Cash transaction action created successfully",
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error("Create Cash Transaction Action Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};

export const getCashTransactionAction = async (req, res) => {
    try {
        const { transactionId } = req.params;

        const [actions] = await pool.query(`
            SELECT * FROM cash_transaction_actions 
            WHERE cash_transaction_id = ? 
            LIMIT 1
        `, [transactionId]);

        return res.status(200).json({
            success: true,
            data: actions.length > 0 ? actions[0] : null
        });
    } catch (error) {
        console.error("Get Cash Transaction Action Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};

export const updateCashTransactionAction = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { 
            purpose, 
            main_category, 
            sub_category, 
            branch, 
            description, 
            spend_mode, 
            vendor_name, 
            vendor_type, 
            gst 
        } = req.body;

        if (!purpose || !purpose.trim()) {
            return res.status(400).json({ success: false, message: "Purpose is required" });
        }

        // Check if cash transaction exists
        const [txn] = await pool.query(`SELECT id FROM cash_transactions WHERE id = ? LIMIT 1`, [transactionId]);
        if (txn.length === 0) {
            return res.status(404).json({ success: false, message: "Cash transaction not found." });
        }

        // Check if action exists
        const [existing] = await pool.query(`SELECT id FROM cash_transaction_actions WHERE cash_transaction_id = ? LIMIT 1`, [transactionId]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: "Cash transaction action not found." });
        }

        await pool.query(`
            UPDATE cash_transaction_actions 
            SET 
                purpose = ?, main_category = ?, sub_category = ?, branch = ?, 
                description = ?, spend_mode = ?, vendor_name = ?, vendor_type = ?, 
                gst = ?, updated_at = NOW() 
            WHERE cash_transaction_id = ?
        `, [
            purpose.trim().substring(0, 255), main_category, sub_category, branch, 
            description, spend_mode, vendor_name, vendor_type, gst, transactionId
        ]);

        return res.status(200).json({
            success: true,
            message: "Cash transaction action updated successfully"
        });
    } catch (error) {
        console.error("Update Cash Transaction Action Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};

export const deleteCashTransactionAction = async (req, res) => {
    try {
        const { transactionId } = req.params;

        const [existing] = await pool.query(`SELECT id FROM cash_transaction_actions WHERE cash_transaction_id = ? LIMIT 1`, [transactionId]);
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Cash transaction action not found."
            });
        }

        await pool.query(`DELETE FROM cash_transaction_actions WHERE cash_transaction_id = ?`, [transactionId]);

        return res.status(200).json({
            success: true,
            message: "Cash transaction action deleted successfully"
        });
    } catch (error) {
        console.error("Delete Cash Transaction Action Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};


export const getCashReconciliationSummary = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: "start_date and end_date are required"
            });
        }

        const [rows] = await pool.query(
            `
            SELECT
                COALESCE(SUM(
                    CASE
                        WHEN ct.dr_amount > 0 THEN ct.dr_amount
                        ELSE 0
                    END
                ), 0) AS dr,

                COALESCE(SUM(
                    CASE
                        WHEN ct.cr_amount > 0 THEN ct.cr_amount
                        ELSE 0
                    END
                ), 0) AS cr

            FROM cash_transactions ct

            LEFT JOIN cash_transaction_actions cta
                ON cta.cash_transaction_id = ct.id

            WHERE cta.id IS NULL
              AND ct.transaction_date >= ?
              AND ct.transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
            `,
            [start_date, end_date]
        );

        return res.status(200).json({
            success: true,
            data: {
                bank_name: "CASH",
                dr: Number(rows[0]?.dr || 0),
                cr: Number(rows[0]?.cr || 0)
            }
        });

    } catch (error) {
        console.error("Cash Reconciliation Summary Error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};
