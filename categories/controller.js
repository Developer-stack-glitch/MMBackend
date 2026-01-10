import { pool } from "../config/dbconfig.js";

// ✅ GET ALL EXPENSE CATEGORIES (grouped)
export const getExpenseCategories = async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT main_category, sub_category, icon, color FROM expense_category ORDER BY id DESC"
        );

        return res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};


// ✅ GET ALL INCOME CATEGORIES
export const getIncomeCategories = async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT category_name AS name, icon, color FROM income_category ORDER BY id DESC"
        );

        return res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};


// ✅ ADD NEW EXPENSE
export const createExpenseCategory = async (req, res) => {
    try {
        const { mainCategory, subCategory, icon, color } = req.body;

        await pool.query(
            `INSERT INTO expense_category (main_category, sub_category, icon, color) 
             VALUES (?, ?, ?, ?)`,
            [mainCategory, subCategory, icon, color]
        );

        return res.json({ message: "Expense category added" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};


// ✅ ADD NEW INCOME
export const createIncomeCategory = async (req, res) => {
    try {
        const { name, icon, color } = req.body;

        await pool.query(
            `INSERT INTO income_category (category_name, icon, color) 
             VALUES (?, ?, ?)`,
            [name, icon, color]
        );

        return res.json({ message: "Income category added" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
