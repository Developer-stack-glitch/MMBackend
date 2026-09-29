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

export const uploadBankStatement = async (req, res) => {
    const file = req.file;
    const { bank_id } = req.body;

    if (!file) {
        return res.status(400).json({ success: false, message: "No Excel file provided." });
    }

    if (!bank_id) {
        if (file) fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: "bank_id is required." });
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
        
        // 1. Verify Bank exists
        const [banks] = await connection.query("SELECT * FROM banks WHERE id = ?", [bank_id]);
        if (banks.length === 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(404).json({ success: false, message: "Bank not found." });
        }

        // 2. Read Excel
        const workbook = xlsx.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

        if (rows.length === 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(400).json({ success: false, message: "Excel file is empty." });
        }

        // 3. Validate Columns
        const firstRow = rows[0];
        const isCashBank = banks[0].bank_name.toUpperCase() === 'CASH';

        let requiredColumns;
        if (isCashBank) {
            requiredColumns = ["Date", "Balance"];
        } else {
            requiredColumns = ["Transaction Date", "Value Date", "Description", "Chq / Ref No.", "Amount", "Dr / Cr", "Balance"];
        }
        
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

        // 4. Parse rows
        const transactions = [];
        let minDate = null;
        let maxDate = null;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            if (isCashBank) {
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

                let amount = 0;
                let drCr = 'CR'; // default
                if (row["CR"] && parseNumber(row["CR"]) > 0) {
                    amount = parseNumber(row["CR"]);
                    drCr = 'CR';
                } else if (row["DR"] && parseNumber(row["DR"]) > 0) {
                    amount = parseNumber(row["DR"]);
                    drCr = 'DR';
                }

                const customData = {
                    sale_executive: row["Sale Executive"] || "",
                    stu_name: row["Stu Name"] || "",
                    stu_number: row["Stu Number"] || "",
                    course: row["Course"] || "",
                    purpose: row["Purpose"] || "",
                    handover_to: row["Handover To"] || "",
                    handover_date: row["Handover date"] || ""
                };

                transactions.push({
                    transaction_date: toMySQLDateTime(txnDate),
                    value_date: toMySQLDate(txnDate),
                    description: JSON.stringify(customData),
                    reference_number: "",
                    amount: amount,
                    transaction_type: drCr,
                    balance: parseNumber(row["Balance"])
                });
            } else {
                const txnDateRaw = row["Transaction Date"];
                if (!txnDateRaw) continue; // Skip empty rows

                const txnDate = parseExcelDate(txnDateRaw);
                const valueDate = parseExcelDate(row["Value Date"] || txnDateRaw);

                if (!txnDate) {
                    fs.unlinkSync(file.path);
                    connection.release();
                    return res.status(400).json({ success: false, message: `Invalid Transaction Date at row ${i + 2}` });
                }

                // Track min/max date for statement date range
                if (!minDate || valueDate < minDate) minDate = valueDate;
                if (!maxDate || valueDate > maxDate) maxDate = valueDate;

                const drCr = (row["Dr / Cr"] || "").toString().trim().toUpperCase();
                if (drCr !== 'CR' && drCr !== 'DR') {
                    fs.unlinkSync(file.path);
                    connection.release();
                    return res.status(400).json({ success: false, message: `Invalid Dr / Cr value at row ${i + 2}. Must be CR or DR.` });
                }

                transactions.push({
                    transaction_date: toMySQLDateTime(txnDate),
                    value_date: toMySQLDate(valueDate),
                    description: (row["Description"] || "").toString().trim(),
                    reference_number: (row["Chq / Ref No."] || "").toString().trim(),
                    amount: parseNumber(row["Amount"]),
                    transaction_type: drCr,
                    balance: parseNumber(row["Balance"])
                });
            }
        }

        if (transactions.length === 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(400).json({ success: false, message: "No valid transaction rows found." });
        }

        const statement_start_date = toMySQLDate(minDate);
        const statement_end_date = toMySQLDate(maxDate);

        // 5. Duplicate Protection
        const [existing] = await connection.query(`
            SELECT id FROM bank_statements 
            WHERE bank_id = ? 
            AND file_name = ? 
            AND statement_start_date = ? 
            AND statement_end_date = ?
        `, [bank_id, file.originalname, statement_start_date, statement_end_date]);

        if (existing.length > 0) {
            fs.unlinkSync(file.path);
            connection.release();
            return res.status(409).json({ success: false, message: "This bank statement has already been uploaded." });
        }

        // 6. Database Transaction
        await connection.beginTransaction();

        // Insert Statement
        const [stmtResult] = await connection.query(`
            INSERT INTO bank_statements (bank_id, file_name, statement_start_date, statement_end_date, uploaded_at)
            VALUES (?, ?, ?, ?, NOW())
        `, [bank_id, file.originalname, statement_start_date, statement_end_date]);

        const statement_id = stmtResult.insertId;

        // Insert Transactions
        const txnValues = transactions.map(t => [
            statement_id,
            bank_id,
            t.transaction_date,
            t.value_date,
            t.description,
            t.reference_number,
            t.amount,
            t.transaction_type,
            t.balance,
            new Date()
        ]);

        await connection.query(`
            INSERT INTO bank_transactions 
            (statement_id, bank_id, transaction_date, value_date, description, reference_number, amount, transaction_type, balance, created_at)
            VALUES ?
        `, [txnValues]);

        await connection.commit();
        connection.release();

        // Cleanup file
        fs.unlinkSync(file.path);

        return res.status(200).json({
            success: true,
            message: "Bank statement uploaded successfully",
            statement_id,
            bank_id,
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

export const getBankTransactions = async (req, res) => {
    const { bankId } = req.params;
    try {
        const [rows] = await pool.query(`
            SELECT t.*, 
                   a.id AS action_id, 
                   a.purpose AS action_purpose, 
                   a.created_by AS action_created_by, 
                   a.created_at AS action_created_at, 
                   a.updated_at AS action_updated_at,
                   a.main_category AS action_main_category,
                   a.sub_category AS action_sub_category,
                   a.branch AS action_branch,
                   a.description AS action_description,
                   a.spend_mode AS action_spend_mode,
                   a.vendor_name AS action_vendor_name,
                   a.vendor_type AS action_vendor_type,
                   a.gst AS action_gst,
                   a.cr_dr AS action_cr_dr
            FROM bank_transactions t
            LEFT JOIN bank_transaction_actions a ON t.id = a.bank_transaction_id
            WHERE t.bank_id = ? 
            ORDER BY t.transaction_date ASC, t.id ASC
        `, [bankId]);

        const transactions = rows.map(row => {
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

            if (action_id) {
                transactionData.action = {
                    id: action_id,
                    bank_transaction_id: transactionData.id,
                    purpose: action_purpose,
                    main_category: action_main_category,
                    sub_category: action_sub_category,
                    branch: action_branch,
                    description: action_description,
                    spend_mode: action_spend_mode,
                    vendor_name: action_vendor_name,
                    vendor_type: action_vendor_type,
                    gst: action_gst,
                    cr_dr: action_cr_dr,
                    created_by: action_created_by,
                    created_at: action_created_at,
                    updated_at: action_updated_at
                };
            } else {
                transactionData.action = null;
            }
            return transactionData;
        });

        return res.status(200).json({
            success: true,
            data: transactions
        });
    } catch (error) {
        console.error("Get Transactions Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const getBankStatementHistory = async (req, res) => {
    const { bankId } = req.params;
    try {
        const [history] = await pool.query(`
            SELECT s.*, COUNT(t.id) as transaction_count 
            FROM bank_statements s
            LEFT JOIN bank_transactions t ON s.id = t.statement_id
            WHERE s.bank_id = ?
            GROUP BY s.id
            ORDER BY s.uploaded_at DESC
        `, [bankId]);

        return res.status(200).json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error("Get History Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const getBankStatementSummary = async (req, res) => {
    const { bankId } = req.params;
    try {
        const [statements] = await pool.query(`
            SELECT * FROM bank_statements 
            WHERE bank_id = ? 
            ORDER BY uploaded_at DESC 
            LIMIT 1
        `, [bankId]);

        if (statements.length === 0) {
            return res.status(200).json({ success: true, summary: null });
        }

        const latestStatement = statements[0];

        const [summary] = await pool.query(`
            SELECT 
                COUNT(*) as total_transactions,
                SUM(CASE WHEN transaction_type = 'CR' THEN amount ELSE 0 END) as total_received,
                SUM(CASE WHEN transaction_type = 'DR' THEN amount ELSE 0 END) as total_spent
            FROM bank_transactions
            WHERE statement_id = ?
        `, [latestStatement.id]);

        return res.status(200).json({
            success: true,
            summary: summary[0] || null
        });
    } catch (error) {
        console.error("Get Summary Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const getAllBanksSummary = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        if (!start_date || !end_date) {
            return res.status(400).json({ success: false, message: "start_date and end_date are required." });
        }

        const startBoundary = `${start_date} 00:00:00`;
        const endBoundary = `${end_date} 23:59:59`;

        const [banks] = await pool.query(`SELECT id, bank_name FROM banks WHERE status = 1`);
        
        const summaryData = [];

        for (const bank of banks) {
            // Check for transactions in period and calculate Income & Expenses
            const [periodRes] = await pool.query(`
                SELECT 
                    COUNT(*) as count,
                    SUM(CASE WHEN transaction_type = 'CR' THEN amount ELSE 0 END) AS income,
                    SUM(CASE WHEN transaction_type = 'DR' THEN amount ELSE 0 END) AS expenses
                FROM bank_transactions 
                WHERE bank_id = ? 
                AND transaction_date >= ? 
                AND transaction_date <= ?
            `, [bank.id, startBoundary, endBoundary]);

            const hasTransactions = periodRes.length > 0 && periodRes[0].count > 0;
            const income = hasTransactions ? Number(periodRes[0].income || 0) : 0;
            const expenses = hasTransactions ? Number(periodRes[0].expenses || 0) : 0;

            let opening_balance = 0;
            let balance = 0;

            if (hasTransactions) {
                // Opening balance
                const [openingRes] = await pool.query(`
                    SELECT balance 
                    FROM bank_transactions 
                    WHERE bank_id = ? 
                    AND transaction_date < ? 
                    ORDER BY transaction_date DESC, id DESC 
                    LIMIT 1
                `, [bank.id, startBoundary]);

                opening_balance = openingRes.length > 0 ? Number(openingRes[0].balance) : 0;

                // Closing balance from DB
                const [closingRes] = await pool.query(`
                    SELECT balance 
                    FROM bank_transactions 
                    WHERE bank_id = ? 
                    AND transaction_date <= ? 
                    ORDER BY transaction_date DESC, id DESC 
                    LIMIT 1
                `, [bank.id, endBoundary]);
                
                balance = closingRes.length > 0 ? Number(closingRes[0].balance) : opening_balance;
            }

            summaryData.push({
                bank_id: bank.id,
                bank_name: bank.bank_name,
                opening_balance,
                income,
                expenses,
                balance
            });
        }

        return res.status(200).json({
            success: true,
            start_date,
            end_date,
            data: summaryData
        });
    } catch (error) {
        console.error("GetAllBanksSummary Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const createTransactionAction = async (req, res) => {
    const { 
        bank_transaction_id, 
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
    
    if (!bank_transaction_id || isNaN(parseInt(bank_transaction_id))) {
        return res.status(400).json({ success: false, message: "Valid bank_transaction_id is required." });
    }
    
    if (!purpose || purpose.trim() === '') {
        return res.status(400).json({ success: false, message: "Purpose is required." });
    }

    try {
        // Check if transaction exists
        const [txn] = await pool.query(`SELECT id, amount, transaction_date, transaction_type FROM bank_transactions WHERE id = ?`, [bank_transaction_id]);
        if (txn.length === 0) {
            return res.status(404).json({ success: false, message: "Bank transaction not found." });
        }

        // Check if action already exists
        const [existing] = await pool.query(`SELECT id FROM bank_transaction_actions WHERE bank_transaction_id = ?`, [bank_transaction_id]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: "An action already exists for this transaction" });
        }

        const originalAmount = txn[0].amount;
        const originalDate = txn[0].transaction_date;
        let cr_dr = txn[0].transaction_type;
        if (cr_dr) {
            cr_dr = cr_dr.trim();
            // Optional: normalize to 'Cr' or 'Dr' if needed, e.g., if it's 'CR' or 'DR'
            if (cr_dr.toUpperCase() === 'CR') cr_dr = 'Cr';
            if (cr_dr.toUpperCase() === 'DR') cr_dr = 'Dr';
        }

        const [result] = await pool.query(
            `INSERT INTO bank_transaction_actions (
                bank_transaction_id, purpose, main_category, sub_category, branch, description, 
                spend_mode, vendor_name, vendor_type, gst, amount, cr_dr, transaction_date, 
                created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                bank_transaction_id, purpose.trim().substring(0, 255), main_category, sub_category, branch, description,
                spend_mode, vendor_name, vendor_type, gst, originalAmount, cr_dr, originalDate,
                req.user.id
            ]
        );

        return res.status(200).json({
            success: true,
            message: "Transaction purpose saved successfully",
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error("Create Action Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const updateTransactionAction = async (req, res) => {
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

    if (!purpose || purpose.trim() === '') {
        return res.status(400).json({ success: false, message: "Purpose is required." });
    }

    try {
        const [action] = await pool.query(`SELECT id FROM bank_transaction_actions WHERE bank_transaction_id = ?`, [transactionId]);
        if (action.length === 0) {
            return res.status(404).json({ success: false, message: "Action not found for this transaction" });
        }

        await pool.query(
            `UPDATE bank_transaction_actions SET 
                purpose = ?, main_category = ?, sub_category = ?, branch = ?, 
                description = ?, spend_mode = ?, vendor_name = ?, vendor_type = ?, 
                gst = ?, updated_at = NOW() 
             WHERE bank_transaction_id = ?`,
            [
                purpose.trim().substring(0, 255), main_category, sub_category, branch, 
                description, spend_mode, vendor_name, vendor_type, gst, transactionId
            ]
        );

        return res.status(200).json({
            success: true,
            message: "Transaction action updated successfully"
        });

    } catch (error) {
        console.error("Update Action Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const deleteTransactionAction = async (req, res) => {
    const { transactionId } = req.params;

    try {
        await pool.query(`DELETE FROM bank_transaction_actions WHERE bank_transaction_id = ?`, [transactionId]);

        return res.status(200).json({
            success: true,
            message: "Transaction action removed successfully"
        });

    } catch (error) {
        console.error("Delete Action Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const getTransactionAction = async (req, res) => {
    const { transactionId } = req.params;

    try {
        const [action] = await pool.query(`SELECT * FROM bank_transaction_actions WHERE bank_transaction_id = ?`, [transactionId]);

        if (action.length === 0) {
            return res.status(404).json({ success: false, message: "Action not found for this transaction", data: null });
        }

        return res.status(200).json({
            success: true,
            data: action[0]
        });

    } catch (error) {
        console.error("Get Action Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const getReconciliationSummary = async (req, res) => {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
        return res.status(400).json({ success: false, message: "start_date and end_date are required." });
    }

    const startBoundary = `${start_date} 00:00:00`;
    const endBoundary = `${end_date} 23:59:59`;

    try {
        const [banks] = await pool.query(`SELECT id, bank_name FROM banks WHERE status = 1`);
        
        const [rows] = await pool.query(`
            SELECT 
                t.bank_id,
                SUM(CASE WHEN t.transaction_type = 'DR' THEN t.amount ELSE 0 END) as dr,
                SUM(CASE WHEN t.transaction_type = 'CR' THEN t.amount ELSE 0 END) as cr
            FROM bank_transactions t
            LEFT JOIN bank_transaction_actions a ON t.id = a.bank_transaction_id
            WHERE t.transaction_date >= ? AND t.transaction_date <= ?
              AND a.id IS NULL
            GROUP BY t.bank_id
        `, [startBoundary, endBoundary]);

        const bankTotals = rows.reduce((acc, row) => {
            acc[row.bank_id] = { dr: Number(row.dr) || 0, cr: Number(row.cr) || 0 };
            return acc;
        }, {});

        const data = banks.map(bank => ({
            bank_id: bank.id,
            bank_name: bank.bank_name,
            dr: bankTotals[bank.id] ? bankTotals[bank.id].dr : 0,
            cr: bankTotals[bank.id] ? bankTotals[bank.id].cr : 0
        }));

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {
        console.error("Get Reconciliation Summary Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};
