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
    deleteExpense,
    getTransactionFilterOptions,
    editIncome,
    getExpensesTotalStats,
    getDashboardStats,
    getDashboardCharts,
    getRecentTransactions,
    deleteIncome,
    bulkUploadExpenses,
    downloadExpenseTemplate,
    getBanks
} from "./controller.js";
import {
    uploadBankStatement,
    getBankTransactions,
    getBankStatementHistory,
    getBankStatementSummary,
    getAllBanksSummary,
    createTransactionAction,
    updateTransactionAction,
    deleteTransactionAction,
    getTransactionAction,
    getReconciliationSummary
} from "./bankStatementController.js";
import {
    uploadCashStatement,
    getCashStatements,
    getCashStatementSummary,
    getCashReconciliationSummary,
    createCashTransactionAction,
    getCashTransactionAction,
    updateCashTransactionAction,
    deleteCashTransactionAction
} from "./cashStatementController.js";
import { verifyToken } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.post("/add-expense", verifyToken, upload.array("invoices", 10), addExpense);
router.post("/add-approval", verifyToken, upload.array("invoices", 10), addApproval);
router.post("/add-income", verifyToken, upload.array("invoices", 10), addIncome);
router.post("/edit-expense", verifyToken, upload.array("invoices", 10), editExpense);
router.post("/edit-income", verifyToken, upload.array("invoices", 10), editIncome);
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
router.get("/dashboard-stats", verifyToken, getDashboardStats);
router.get("/dashboard-charts", verifyToken, getDashboardCharts);
router.get("/recent-transactions", verifyToken, getRecentTransactions);
router.get("/filter-options", verifyToken, getTransactionFilterOptions);
router.get("/expense-stats", verifyToken, getExpensesTotalStats);
router.delete("/delete-expense/:id", verifyToken, deleteExpense);
router.delete("/delete-income/:id", verifyToken, deleteIncome);

router.post("/bulk-upload-expenses", verifyToken, upload.array("files", 100), bulkUploadExpenses);
router.get("/download-expense-template", downloadExpenseTemplate);

// Bank Statements
router.post("/bank-statements/upload", verifyToken, upload.single("statement"), uploadBankStatement);
router.get("/bank-statements/summary", verifyToken, getAllBanksSummary);
router.get("/bank-statements/reconciliation-summary", verifyToken, getReconciliationSummary);
router.post("/bank-statements/transaction-action", verifyToken, createTransactionAction);
router.put("/bank-statements/transaction-action/:transactionId", verifyToken, updateTransactionAction);
router.delete("/bank-statements/transaction-action/:transactionId", verifyToken, deleteTransactionAction);
router.get("/bank-statements/transaction-action/:transactionId", verifyToken, getTransactionAction);
router.get("/bank-statements/:bankId", verifyToken, getBankTransactions);
router.get("/bank-statements/:bankId/history", verifyToken, getBankStatementHistory);
router.get("/bank-statements/:bankId/summary", verifyToken, getBankStatementSummary);
router.get("/banks", verifyToken, getBanks);

// Cash Statements
router.post("/cash-statements/upload", verifyToken, upload.single("statement"), uploadCashStatement);
router.get("/cash-statements", verifyToken, getCashStatements);
router.get("/cash-statements/summary", verifyToken, getCashStatementSummary);
router.post("/cash-statements/transaction-action", verifyToken, createCashTransactionAction);
router.get("/cash-statements/transaction-action/:transactionId", verifyToken, getCashTransactionAction);
router.put("/cash-statements/transaction-action/:transactionId", verifyToken, updateCashTransactionAction);
router.delete("/cash-statements/transaction-action/:transactionId", verifyToken, deleteCashTransactionAction);
router.get("/cash-statements/reconciliation-summary", verifyToken, getCashReconciliationSummary);

export default router;
