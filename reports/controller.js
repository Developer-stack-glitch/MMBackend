import { pool } from "../config/dbconfig.js";
import ExcelJS from "exceljs";

export const downloadBranchReportExcel = async (req, res) => {
    try {
        const { start_date, end_date, category, sub_category, transaction_type } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({ message: "Start date and End date are required." });
        }

        // 1. Fetch Branches
        const [branches] = await pool.query("SELECT name FROM branches WHERE is_active = 1 ORDER BY id ASC");
        const branchNames = branches.map(b => b.name);

        // 2. Fetch Data
        // Need to add end_date 23:59:59 support
        let endDateEnd = end_date;
        if (endDateEnd.length === 10) endDateEnd += " 23:59:59";

        let startDateStart = start_date;
        if (startDateStart.length === 10) startDateStart += " 00:00:00";

        let queryParamsBank = [startDateStart, endDateEnd];
        let categoryFilterBank = "";
        let queryParamsCash = [startDateStart, endDateEnd];
        let categoryFilterCash = "";

        if (category && category !== "All Categories" && category !== "OVERALL") {
            const categories = category.split(',');
            categoryFilterBank += ` AND a.main_category IN (${categories.map(() => '?').join(',')})`;
            queryParamsBank.push(...categories);
            categoryFilterCash += ` AND a.main_category IN (${categories.map(() => '?').join(',')})`;
            queryParamsCash.push(...categories);
        }

        if (sub_category) {
            const subCategories = sub_category.split(',');
            categoryFilterBank += ` AND a.sub_category IN (${subCategories.map(() => '?').join(',')})`;
            queryParamsBank.push(...subCategories);
            categoryFilterCash += ` AND a.sub_category IN (${subCategories.map(() => '?').join(',')})`;
            queryParamsCash.push(...subCategories);
        }

        if (transaction_type === 'Credit') {
            categoryFilterBank += " AND t.transaction_type = 'CR'";
            categoryFilterCash += " AND UPPER(a.cr_dr) = 'CR'";
        } else if (transaction_type === 'Debit') {
            categoryFilterBank += " AND t.transaction_type = 'DR'";
            categoryFilterCash += " AND UPPER(a.cr_dr) = 'DR'";
        }

        const query = `
            SELECT 
                main_category, 
                sub_category, 
                branch, 
                transaction_type, 
                SUM(amount) as total_amount
            FROM (
                SELECT 
                    a.main_category, 
                    a.sub_category, 
                    a.branch, 
                    t.transaction_type, 
                    a.amount
                FROM bank_transaction_actions a
                JOIN bank_transactions t ON a.bank_transaction_id = t.id
                WHERE a.transaction_date >= ? AND a.transaction_date <= ? ${categoryFilterBank}
                
                UNION ALL
                
                SELECT 
                    a.main_category, 
                    a.sub_category, 
                    a.branch, 
                    UPPER(a.cr_dr) as transaction_type, 
                    a.amount
                FROM cash_transaction_actions a
                WHERE a.transaction_date >= ? AND a.transaction_date <= ? ${categoryFilterCash}
            ) as combined_data
            GROUP BY main_category, sub_category, branch, transaction_type
        `;

        const [results] = await pool.query(query, [...queryParamsBank, ...queryParamsCash]);

        // Fetch category colors
        const [categoriesColors] = await pool.query(
            "SELECT main_category, color FROM expense_category GROUP BY main_category"
        );
        const categoryColorMap = {};
        categoriesColors.forEach(c => {
            let hexColor = (c.color || '#cccccc').replace('#', '');
            if (hexColor.length === 3) {
                hexColor = hexColor.split('').map(x => x + x).join('');
            }
            if (hexColor.length === 8) {
                hexColor = hexColor.substring(0, 6);
            }
            categoryColorMap[c.main_category] = hexColor;
        });

        // 3. Process Data
        const reportData = {};
        const branchExpenses = {};
        const branchTurnover = {};
        branchNames.forEach(b => {
            branchExpenses[b] = 0;
            branchTurnover[b] = 0;
        });

        let totalExpensesAll = 0;
        let totalTurnoverAll = 0;

        results.forEach(row => {
            const { main_category, sub_category, branch, transaction_type, total_amount } = row;
            const amount = parseFloat(total_amount) || 0;

            if (!reportData[main_category]) {
                reportData[main_category] = {};
            }
            if (!reportData[main_category][sub_category]) {
                reportData[main_category][sub_category] = {};
            }

            if (!reportData[main_category][sub_category][branch]) {
                reportData[main_category][sub_category][branch] = 0;
            }

            reportData[main_category][sub_category][branch] += amount;

            // Totals
            if (transaction_type === 'DR') {
                if (branchExpenses[branch] !== undefined) branchExpenses[branch] += amount;
                totalExpensesAll += amount;
            } else if (transaction_type === 'CR') {
                if (branchTurnover[branch] !== undefined) branchTurnover[branch] += amount;
                totalTurnoverAll += amount;
            }
        });

        // Generate Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Branch wise Expenses");

        // Format Date title
        sheet.mergeCells("A1", "C1");
        sheet.getCell("A1").value = "Branch wise Expenses";
        sheet.getCell("A1").font = { size: 16, bold: true };

        sheet.mergeCells("A2", "C2");
        sheet.getCell("A2").value = `${start_date} → ${end_date}`;
        sheet.getCell("A2").font = { bold: true };

        // Headers
        const headerRow = ["CATEGORY", ...branchNames, "TOTAL"];
        const headerObj = sheet.addRow(headerRow);

        headerObj.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        // Rows
        Object.keys(reportData).forEach(mainCategory => {
            // Main Category Header
            const mainCatRow = sheet.addRow([mainCategory, ...branchNames.map(() => ""), ""]);
            let catColor = categoryColorMap[mainCategory] || "cccccc";
            mainCatRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White text
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: `FF${catColor}` }
                };
                cell.border = {
                    top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
                };
            });

            // Sub Categories
            Object.keys(reportData[mainCategory]).forEach(subCategory => {
                const rowData = [subCategory];
                let rowTotal = 0;
                branchNames.forEach(branch => {
                    const amount = reportData[mainCategory][subCategory][branch] || 0;
                    rowData.push(amount);
                    rowTotal += amount;
                });
                rowData.push(rowTotal);

                const subCatRow = sheet.addRow(rowData);
                subCatRow.eachCell((cell, colNumber) => {
                    cell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
                    };
                    if (colNumber > 1) { // Numbers
                        cell.numFmt = '#,##0.00';
                    }
                });
                // highlight TOTAL column
                const totalCell = subCatRow.getCell(branchNames.length + 2);
                totalCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFE599' }
                };
            });
        });

        // Totals Rows

        // Expenses
        const expRowData = ["Expenses"];
        branchNames.forEach(branch => {
            expRowData.push(branchExpenses[branch]);
        });
        expRowData.push(totalExpensesAll);

        const expRow = sheet.addRow(expRowData);
        expRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFF0000' } }; // Red
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } }; // Light Red
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        // Turnover
        const turnRowData = ["Turnover"];
        branchNames.forEach(branch => {
            turnRowData.push(branchTurnover[branch]);
        });
        turnRowData.push(totalTurnoverAll);

        const turnRow = sheet.addRow(turnRowData);
        turnRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FF008000' } }; // Green
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFFCC' } }; // Light Green
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        // Net Profit
        const profitRowData = ["Net Profit"];
        branchNames.forEach(branch => {
            profitRowData.push(branchTurnover[branch] - branchExpenses[branch]);
        });
        profitRowData.push(totalTurnoverAll - totalExpensesAll);

        const profitRow = sheet.addRow(profitRowData);
        profitRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008000' } }; // Dark Green
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        // Auto adjust width for column 1
        sheet.getColumn(1).width = 30;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=Branch_Wise_Report_${start_date}_to_${end_date}.xlsx`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Error generating Excel report:", err);

        return res.status(500).json({
            success: false,
            message: err.message,
            error: err.code || null,
            sqlMessage: err.sqlMessage || null
        });
    }
};

export const downloadMonthReportExcel = async (req, res) => {
    try {
        const { start_date, end_date, category, sub_category, transaction_type } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({ message: "Start date and End date are required." });
        }

        const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

        let endDateEnd = end_date;
        if (endDateEnd.length === 10) endDateEnd += " 23:59:59";

        let startDateStart = start_date;
        if (startDateStart.length === 10) startDateStart += " 00:00:00";

        let queryParams = [startDateStart, endDateEnd];
        let categoryFilter = "";

        if (category && category !== "All Categories" && category !== "OVERALL") {
            categoryFilter += " AND a.main_category = ?";
            queryParams.push(category);
        }

        if (sub_category) {
            categoryFilter += " AND a.sub_category = ?";
            queryParams.push(sub_category);
        }

        if (transaction_type === 'Credit') {
            categoryFilter += " AND t.transaction_type = 'CR'";
        } else if (transaction_type === 'Debit') {
            categoryFilter += " AND t.transaction_type = 'DR'";
        }

        const query = `
            SELECT 
                a.main_category, 
                a.sub_category, 
                MONTH(a.transaction_date) as tx_month, 
                t.transaction_type, 
                SUM(a.amount) as total_amount
            FROM bank_transaction_actions a
            JOIN bank_transactions t ON a.bank_transaction_id = t.id
            WHERE a.transaction_date >= ? AND a.transaction_date <= ? ${categoryFilter}
            GROUP BY a.main_category, a.sub_category, MONTH(a.transaction_date), t.transaction_type
        `;

        const [results] = await pool.query(query, queryParams);

        // Fetch category colors
        const [categoriesColors] = await pool.query(
            "SELECT main_category, color FROM expense_category GROUP BY main_category"
        );
        const categoryColorMap = {};
        categoriesColors.forEach(c => {
            let hexColor = (c.color || '#cccccc').replace('#', '');
            if (hexColor.length === 3) {
                hexColor = hexColor.split('').map(x => x + x).join('');
            }
            if (hexColor.length === 8) {
                hexColor = hexColor.substring(0, 6);
            }
            categoryColorMap[c.main_category] = hexColor;
        });

        // Process Data
        const reportData = {};
        const monthExpenses = {};
        const monthTurnover = {};
        months.forEach((m, idx) => {
            monthExpenses[idx + 1] = 0;
            monthTurnover[idx + 1] = 0;
        });

        let totalExpensesAll = 0;
        let totalTurnoverAll = 0;

        results.forEach(row => {
            const { main_category, sub_category, tx_month, transaction_type } = row;
            const amount = parseFloat(row.total_amount) || 0;

            if (!reportData[main_category]) {
                reportData[main_category] = {};
            }
            if (!reportData[main_category][sub_category]) {
                reportData[main_category][sub_category] = {};
            }
            if (!reportData[main_category][sub_category][tx_month]) {
                reportData[main_category][sub_category][tx_month] = 0;
            }

            reportData[main_category][sub_category][tx_month] += amount;

            if (transaction_type === 'DR') {
                if (monthExpenses[tx_month] !== undefined) monthExpenses[tx_month] += amount;
                totalExpensesAll += amount;
            } else if (transaction_type === 'CR') {
                if (monthTurnover[tx_month] !== undefined) monthTurnover[tx_month] += amount;
                totalTurnoverAll += amount;
            }
        });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Monthly Report");

        // Top Header
        sheet.mergeCells("A1", "C1");
        sheet.getCell("A1").value = "Monthly Expenses";
        sheet.getCell("A1").font = { size: 16, bold: true };
        sheet.getCell("A1").fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF58220' } }; // Orange background
        
        sheet.mergeCells("A2", "C2");
        sheet.getCell("A2").value = `${start_date} → ${end_date}`;
        sheet.getCell("A2").font = { bold: true };
        sheet.addRow([]); // Empty row

        // Headers
        const headerRow = ["CATEGORY", ...months, "TOTAL"];
        const headerObj = sheet.addRow(headerRow);

        headerObj.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        Object.keys(reportData).forEach(mainCategory => {
            const catColor = categoryColorMap[mainCategory] || 'CCCCCC';
            
            // Main Category row
            const mainRowData = [mainCategory];
            let mainCatTotal = 0;
            months.forEach((m, idx) => {
                let monthSum = 0;
                Object.keys(reportData[mainCategory]).forEach(subCat => {
                    monthSum += (reportData[mainCategory][subCat][idx + 1] || 0);
                });
                mainRowData.push(monthSum);
                mainCatTotal += monthSum;
            });
            mainRowData.push(mainCatTotal);

            const catRow = sheet.addRow(mainRowData);
            catRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White text
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: `FF${catColor}` }
                };
                cell.border = {
                    top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
                };
                if (colNumber > 1) cell.numFmt = '#,##0.00';
            });

            // Sub Categories
            Object.keys(reportData[mainCategory]).forEach(subCategory => {
                const rowData = [subCategory];
                let rowTotal = 0;
                months.forEach((m, idx) => {
                    const amount = reportData[mainCategory][subCategory][idx + 1] || 0;
                    rowData.push(amount);
                    rowTotal += amount;
                });
                rowData.push(rowTotal);

                const subCatRow = sheet.addRow(rowData);
                subCatRow.eachCell((cell, colNumber) => {
                    cell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
                    };
                    if (colNumber > 1) { 
                        cell.numFmt = '#,##0.00';
                    }
                    if (colNumber === 1) {
                         cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; 
                    }
                });
                // highlight TOTAL column
                const totalCell = subCatRow.getCell(months.length + 2);
                totalCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFE599' }
                };
            });
        });

        // Totals Rows
        // Expenses
        const expRowData = ["Expenses"];
        months.forEach((m, idx) => {
            expRowData.push(monthExpenses[idx + 1] || 0);
        });
        expRowData.push(totalExpensesAll);

        const expRow = sheet.addRow(expRowData);
        expRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFF0000' } }; // Red
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9D0C4' } }; // Light Red from screenshot
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        // Turnover
        const turnRowData = ["Turnover"];
        months.forEach((m, idx) => {
            turnRowData.push(monthTurnover[idx + 1] || 0);
        });
        turnRowData.push(totalTurnoverAll);

        const turnRow = sheet.addRow(turnRowData);
        turnRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FF38761D' } }; // Teal/Green
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } }; // Beige/Light orange
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        // Net Profit
        const profitRowData = ["Net Profit"];
        months.forEach((m, idx) => {
            const turnover = monthTurnover[idx + 1] || 0;
            const expense = monthExpenses[idx + 1] || 0;
            profitRowData.push(turnover - expense);
        });
        profitRowData.push(totalTurnoverAll - totalExpensesAll);

        const profitRow = sheet.addRow(profitRowData);
        profitRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF93C47D' } }; // Green
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        sheet.getColumn(1).width = 30;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=Monthly_Wise_Report_${start_date}_to_${end_date}.xlsx`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Error generating Excel report:", err);

        return res.status(500).json({
            success: false,
            message: err.message,
            error: err.code || null,
            sqlMessage: err.sqlMessage || null
        });
    }
};


export const downloadOverallReportExcel = async (req, res) => {
    try {
        const { start_date, end_date, category, sub_category, transaction_type } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({ message: "Start date and End date are required." });
        }

        let endDateEnd = end_date;
        if (endDateEnd.length === 10) endDateEnd += " 23:59:59";

        let startDateStart = start_date;
        if (startDateStart.length === 10) startDateStart += " 00:00:00";

        let queryParams = [startDateStart, endDateEnd];
        let categoryFilter = "";

        if (category && category !== "All Categories" && category !== "OVERALL") {
            categoryFilter += " AND a.main_category = ?";
            queryParams.push(category);
        }

        if (sub_category) {
            categoryFilter += " AND a.sub_category = ?";
            queryParams.push(sub_category);
        }

        if (transaction_type === 'Credit') {
            categoryFilter += " AND t.transaction_type = 'CR'";
        } else if (transaction_type === 'Debit') {
            categoryFilter += " AND t.transaction_type = 'DR'";
        }

        // ======================= BRANCH WISE LOGIC =======================
        const [branches] = await pool.query("SELECT name FROM branches WHERE is_active = 1 ORDER BY id ASC");
        const branchNames = branches.map(b => b.name);

        const branchQuery = `
            SELECT 
                a.main_category, 
                a.sub_category, 
                a.branch, 
                t.transaction_type, 
                SUM(a.amount) as total_amount
            FROM bank_transaction_actions a
            JOIN bank_transactions t ON a.bank_transaction_id = t.id
            WHERE a.transaction_date >= ? AND a.transaction_date <= ? ${categoryFilter}
            GROUP BY a.main_category, a.sub_category, a.branch, t.transaction_type
        `;
        const [branchResults] = await pool.query(branchQuery, queryParams);

        // Fetch category colors
        const [categoriesColors] = await pool.query("SELECT main_category, color FROM expense_category GROUP BY main_category");
        const categoryColorMap = {};
        categoriesColors.forEach(c => {
            let hexColor = (c.color || '#cccccc').replace('#', '');
            if (hexColor.length === 3) {
                hexColor = hexColor.split('').map(x => x + x).join('');
            }
            if (hexColor.length === 8) {
                hexColor = hexColor.substring(0, 6);
            }
            categoryColorMap[c.main_category] = hexColor;
        });

        const branchReportData = {};
        const branchExpenses = {};
        const branchTurnover = {};
        branchNames.forEach(b => {
            branchExpenses[b] = 0;
            branchTurnover[b] = 0;
        });

        let branchTotalExpensesAll = 0;
        let branchTotalTurnoverAll = 0;

        branchResults.forEach(row => {
            const { main_category, sub_category, branch, transaction_type, total_amount } = row;
            const amount = parseFloat(total_amount) || 0;

            if (!branchReportData[main_category]) branchReportData[main_category] = {};
            if (!branchReportData[main_category][sub_category]) branchReportData[main_category][sub_category] = {};
            if (!branchReportData[main_category][sub_category][branch]) branchReportData[main_category][sub_category][branch] = 0;

            branchReportData[main_category][sub_category][branch] += amount;

            if (transaction_type === 'DR') {
                if (branchExpenses[branch] !== undefined) branchExpenses[branch] += amount;
                branchTotalExpensesAll += amount;
            } else if (transaction_type === 'CR') {
                if (branchTurnover[branch] !== undefined) branchTurnover[branch] += amount;
                branchTotalTurnoverAll += amount;
            }
        });


        // ======================= MONTH WISE LOGIC =======================
        const monthQuery = `
            SELECT 
                a.main_category, 
                a.sub_category, 
                MONTH(a.transaction_date) as tx_month, 
                t.transaction_type, 
                SUM(a.amount) as total_amount
            FROM bank_transaction_actions a
            JOIN bank_transactions t ON a.bank_transaction_id = t.id
            WHERE a.transaction_date >= ? AND a.transaction_date <= ? ${categoryFilter}
            GROUP BY a.main_category, a.sub_category, MONTH(a.transaction_date), t.transaction_type
        `;
        const [monthResults] = await pool.query(monthQuery, queryParams);

        const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const monthReportData = {};
        const monthExpenses = {};
        const monthTurnover = {};
        months.forEach((m, idx) => {
            monthExpenses[idx + 1] = 0;
            monthTurnover[idx + 1] = 0;
        });

        let monthTotalExpensesAll = 0;
        let monthTotalTurnoverAll = 0;

        monthResults.forEach(row => {
            const { main_category, sub_category, tx_month, transaction_type } = row;
            const amount = parseFloat(row.total_amount) || 0;

            if (!monthReportData[main_category]) monthReportData[main_category] = {};
            if (!monthReportData[main_category][sub_category]) monthReportData[main_category][sub_category] = {};
            if (!monthReportData[main_category][sub_category][tx_month]) monthReportData[main_category][sub_category][tx_month] = 0;

            monthReportData[main_category][sub_category][tx_month] += amount;

            if (transaction_type === 'DR') {
                if (monthExpenses[tx_month] !== undefined) monthExpenses[tx_month] += amount;
                monthTotalExpensesAll += amount;
            } else if (transaction_type === 'CR') {
                if (monthTurnover[tx_month] !== undefined) monthTurnover[tx_month] += amount;
                monthTotalTurnoverAll += amount;
            }
        });

        // ======================= GENERATE EXCEL =======================
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Overall Expenses");

        // --- BRANCH PART ---
        sheet.mergeCells("A1", "C1");
        sheet.getCell("A1").value = "Branch wise Expenses";
        sheet.getCell("A1").font = { size: 16, bold: true };

        sheet.mergeCells("A2", "C2");
        sheet.getCell("A2").value = `${start_date} → ${end_date}`;
        sheet.getCell("A2").font = { bold: true };

        const headerRowBranch = ["CATEGORY", ...branchNames, "TOTAL"];
        const headerObjBranch = sheet.addRow(headerRowBranch);

        headerObjBranch.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        Object.keys(branchReportData).forEach(mainCategory => {
            const mainCatRow = sheet.addRow([mainCategory, ...branchNames.map(() => ""), ""]);
            let catColor = categoryColorMap[mainCategory] || "cccccc";
            mainCatRow.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${catColor}` } };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });

            Object.keys(branchReportData[mainCategory]).forEach(subCategory => {
                const rowData = [subCategory];
                let rowTotal = 0;
                branchNames.forEach(branch => {
                    const amount = branchReportData[mainCategory][subCategory][branch] || 0;
                    rowData.push(amount);
                    rowTotal += amount;
                });
                rowData.push(rowTotal);

                const subCatRow = sheet.addRow(rowData);
                subCatRow.eachCell((cell, colNumber) => {
                    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                    if (colNumber > 1) cell.numFmt = '#,##0.00';
                });
                const totalCell = subCatRow.getCell(branchNames.length + 2);
                totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE599' } };
            });
        });

        // Totals
        const expRowDataB = ["Expenses"];
        branchNames.forEach(branch => expRowDataB.push(branchExpenses[branch]));
        expRowDataB.push(branchTotalExpensesAll);
        const expRowB = sheet.addRow(expRowDataB);
        expRowB.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFF0000' } }; 
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } }; 
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        const turnRowDataB = ["Turnover"];
        branchNames.forEach(branch => turnRowDataB.push(branchTurnover[branch]));
        turnRowDataB.push(branchTotalTurnoverAll);
        const turnRowB = sheet.addRow(turnRowDataB);
        turnRowB.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FF008000' } }; 
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFFCC' } }; 
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        const profitRowDataB = ["Net Profit"];
        branchNames.forEach(branch => profitRowDataB.push(branchTurnover[branch] - branchExpenses[branch]));
        profitRowDataB.push(branchTotalTurnoverAll - branchTotalExpensesAll);
        const profitRowB = sheet.addRow(profitRowDataB);
        profitRowB.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; 
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008000' } }; 
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        sheet.addRow([]);
        sheet.addRow([]);
        sheet.addRow([]);

        // --- MONTH PART ---
        const monthStartRow = sheet.rowCount + 1;
        sheet.mergeCells(`A${monthStartRow}`, `C${monthStartRow}`);
        const titleCellM = sheet.getCell(`A${monthStartRow}`);
        titleCellM.value = "Monthly Expenses";
        titleCellM.font = { size: 16, bold: true };

        const monthDateRow = sheet.rowCount + 1;
        sheet.mergeCells(`A${monthDateRow}`, `C${monthDateRow}`);
        const dateCellM = sheet.getCell(`A${monthDateRow}`);
        dateCellM.value = `${start_date} → ${end_date}`;
        dateCellM.font = { bold: true };

        const headerRowMonth = ["CATEGORY", ...months, "TOTAL"];
        const headerObjMonth = sheet.addRow(headerRowMonth);
        headerObjMonth.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        Object.keys(monthReportData).forEach(mainCategory => {
            const catColor = categoryColorMap[mainCategory] || 'CCCCCC';
            
            const mainRowData = [mainCategory];
            let mainCatTotal = 0;
            months.forEach((m, idx) => {
                let monthSum = 0;
                Object.keys(monthReportData[mainCategory]).forEach(subCat => {
                    monthSum += (monthReportData[mainCategory][subCat][idx + 1] || 0);
                });
                mainRowData.push(monthSum);
                mainCatTotal += monthSum;
            });
            mainRowData.push(mainCatTotal);

            const catRow = sheet.addRow(mainRowData);
            catRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; 
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${catColor}` } };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                if (colNumber > 1) cell.numFmt = '#,##0.00';
            });

            Object.keys(monthReportData[mainCategory]).forEach(subCategory => {
                const rowData = [subCategory];
                let rowTotal = 0;
                months.forEach((m, idx) => {
                    const amount = monthReportData[mainCategory][subCategory][idx + 1] || 0;
                    rowData.push(amount);
                    rowTotal += amount;
                });
                rowData.push(rowTotal);

                const subCatRow = sheet.addRow(rowData);
                subCatRow.eachCell((cell, colNumber) => {
                    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                    if (colNumber > 1) cell.numFmt = '#,##0.00';
                    if (colNumber === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; 
                });
                const totalCell = subCatRow.getCell(months.length + 2);
                totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE599' } };
            });
        });

        const expRowDataM = ["Expenses"];
        months.forEach((m, idx) => expRowDataM.push(monthExpenses[idx + 1] || 0));
        expRowDataM.push(monthTotalExpensesAll);
        const expRowM = sheet.addRow(expRowDataM);
        expRowM.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFF0000' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9D0C4' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        const turnRowDataM = ["Turnover"];
        months.forEach((m, idx) => turnRowDataM.push(monthTurnover[idx + 1] || 0));
        turnRowDataM.push(monthTotalTurnoverAll);
        const turnRowM = sheet.addRow(turnRowDataM);
        turnRowM.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FF38761D' } }; 
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        const profitRowDataM = ["Net Profit"];
        months.forEach((m, idx) => {
            const turnover = monthTurnover[idx + 1] || 0;
            const expense = monthExpenses[idx + 1] || 0;
            profitRowDataM.push(turnover - expense);
        });
        profitRowDataM.push(monthTotalTurnoverAll - monthTotalExpensesAll);
        const profitRowM = sheet.addRow(profitRowDataM);
        profitRowM.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; 
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF93C47D' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNumber > 1) cell.numFmt = '#,##0.00';
        });

        sheet.getColumn(1).width = 30;

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=Overall_Wise_Report_${start_date}_to_${end_date}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Error generating Overall Excel report:", err);
        return res.status(500).json({ success: false, message: err.message, error: err.code || null, sqlMessage: err.sqlMessage || null });
    }
};
