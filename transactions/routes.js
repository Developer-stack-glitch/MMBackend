import express from "express";
import {
    addExpense,
    addApproval,
    addIncome,
    getAllExpenses,
    getAllIncome,
    getSummary,
    getLastMonthSummary,
    getApprovals,
    approveExpense,
    rejectExpense,
    getExpensesPaginated,
    getIncomePaginated,
    editExpense,
    getUserAllExpenses,
    deleteExpense
} from "./controller.js";
import { verifyToken } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.post("/add-expense", verifyToken, upload.array("invoices", 10), addExpense);
router.post("/add-approval", verifyToken, upload.array("invoices", 10), addApproval);
router.post("/add-income", verifyToken, upload.array("invoices", 10), addIncome);
router.post("/edit-expense", verifyToken, upload.array("invoices", 10), editExpense);
router.get("/expenses-transactions", verifyToken, getAllExpenses);
router.get("/income-transactions", verifyToken, getAllIncome);
router.get("/summary", getSummary);
router.get("/last-month-summary", getLastMonthSummary);
router.get("/approvals", verifyToken, getApprovals);
router.post("/approve-expense", approveExpense);
router.post("/reject-expense", rejectExpense);
router.get("/expenses-paginated", verifyToken, getExpensesPaginated);
router.get("/income-paginated", verifyToken, getIncomePaginated);
router.get("/user-all-expenses", verifyToken, getUserAllExpenses);
router.delete("/delete-expense/:id", verifyToken, deleteExpense);

export default router;
