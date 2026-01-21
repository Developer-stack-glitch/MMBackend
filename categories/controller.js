import { pool } from "../config/dbconfig.js";

// ✅ GET ALL EXPENSE CATEGORIES (grouped)
export const getExpenseCategories = async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT id, main_category, sub_category, icon, color FROM expense_category ORDER BY id DESC"
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
            "SELECT id, category_name AS name, icon, color FROM income_category ORDER BY id DESC"
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

// ✅ UPDATE EXPENSE CATEGORY
export const updateExpenseCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { mainCategory, subCategory, icon, color } = req.body;

        await pool.query(
            `UPDATE expense_category 
             SET main_category = ?, sub_category = ?, icon = ?, color = ? 
             WHERE id = ?`,
            [mainCategory, subCategory, icon, color, id]
        );

        return res.json({ message: "Expense category updated" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// ✅ UPDATE INCOME CATEGORY
export const updateIncomeCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, color } = req.body;

        await pool.query(
            `UPDATE income_category 
             SET category_name = ?, icon = ?, color = ? 
             WHERE id = ?`,
            [name, icon, color, id]
        );

        return res.json({ message: "Income category updated" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// ✅ DELETE EXPENSE CATEGORY (Single or All by Main)
export const deleteExpenseCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { deleteMain } = req.query;

        if (deleteMain === "true") {
            const [rows] = await pool.query("SELECT main_category FROM expense_category WHERE id = ?", [id]);
            if (rows.length === 0) return res.status(404).json({ error: "Category not found" });

            const mainCat = rows[0].main_category;
            await pool.query("DELETE FROM expense_category WHERE main_category = ?", [mainCat]);
            return res.json({ message: `Main category '${mainCat}' and all sub-categories deleted` });
        } else {
            await pool.query("DELETE FROM expense_category WHERE id = ?", [id]);
            return res.json({ message: "Sub-category deleted" });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// ✅ DELETE MAIN CATEGORY (Deleting by Name)
export const deleteExpenseCategoryMain = async (req, res) => {
    try {
        const { mainCategory } = req.params;
        const decodedMain = decodeURIComponent(mainCategory);
        await pool.query("DELETE FROM expense_category WHERE main_category = ?", [decodedMain]);
        return res.json({ message: `Main category '${decodedMain}' deleted` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// ✅ DELETE INCOME CATEGORY
export const deleteIncomeCategory = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM income_category WHERE id = ?", [id]);
        return res.json({ message: "Income category deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
