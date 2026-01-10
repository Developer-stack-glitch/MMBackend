import { Router } from "express";
import {
    getExpenseCategories,
    getIncomeCategories,
    createExpenseCategory,
    createIncomeCategory
} from "./controller.js";

const router = Router();

router.get("/expense-category", getExpenseCategories);
router.get("/income-category", getIncomeCategories);

router.post("/expense/add", createExpenseCategory);
router.post("/income/add", createIncomeCategory);


export default router;
