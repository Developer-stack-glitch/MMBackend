import express from "express";
import { downloadBranchReportExcel, downloadMonthReportExcel, downloadOverallReportExcel } from "./controller.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.get("/branch/download", verifyToken, downloadBranchReportExcel);
router.get("/month/download", verifyToken, downloadMonthReportExcel);
router.get("/overall/download", verifyToken, downloadOverallReportExcel);

export default router;
