// routes/walletRoutes.js
import express from "express";
import {
    addWallet,
    getWalletEntries,
    getWalletPaginated,
    getAllWalletDetails,
    getAllWalletTransactions,
    getVendors,
    addVendor
} from "./controller.js";

import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// ADD WALLET ENTRY
router.post("/add-wallet", addWallet);


// GET WALLET LIST (protected)
router.get("/wallet/:userId", verifyToken, getWalletEntries);
router.get("/wallet-paginated/:userId", verifyToken, getWalletPaginated);

// GET ALL WALLET DETAILS (protected)
router.get("/wallet-details", verifyToken, getAllWalletDetails);
router.get("/all-wallet-transactions", verifyToken, getAllWalletTransactions);

// VENDORS
router.get("/vendors", verifyToken, getVendors);
router.post("/add-vendor", verifyToken, addVendor);

export default router;
