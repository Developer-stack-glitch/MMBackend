import { Router } from "express";
import {
    getExpenseCategories,
    getIncomeCategories,
    createExpenseCategory,
    createIncomeCategory,
    updateExpenseCategory,
    updateIncomeCategory,
    deleteExpenseCategory,
    deleteExpenseCategoryMain,
    deleteIncomeCategory
} from "./controller.js";

const router = Router();

router.get("/expense-category", getExpenseCategories);
router.get("/income-category", getIncomeCategories);

router.post("/expense/add", createExpenseCategory);
router.post("/income/add", createIncomeCategory);

router.put("/expense/update/:id", updateExpenseCategory);
router.put("/income/update/:id", updateIncomeCategory);

router.delete("/expense/delete/:id", deleteExpenseCategory);
router.delete("/expense/delete-main/:mainCategory", deleteExpenseCategoryMain);
router.delete("/income/delete/:id", deleteIncomeCategory);

export default router;
