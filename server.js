import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import walletRoutes from "./wallet/routes.js";
import authRoutes from "./auth/routes.js";
import categoryRoutes from "./categories/routes.js";
import transactionRoutes from "./transactions/routes.js";
import calendarRoutes from "./calendar/routes.js";
import { initializeAlertScheduler } from "./calendar/alertScheduler.js";

dotenv.config();

const app = express();

// Security & utils
app.use(
    helmet({
        crossOriginResourcePolicy: false,
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                connectSrc: ["'self'", "http:", "https:"],
            },
        },
    })
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:5173",
        credentials: true
    })
);

// FIX: allow images/pdf loading
app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
});


// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/calendar", calendarRoutes);
app.use(
    "/uploads",
    cors({
        origin: ["http://localhost:5173", "http://127.0.0.1:5173", "https://money.actecrm.com"],
        credentials: true,
    }),
    express.static("uploads")
);


// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    // Initialize calendar alert scheduler
    initializeAlertScheduler();
});
