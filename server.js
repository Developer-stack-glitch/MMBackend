import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import walletRoutes from "./wallet/routes.js";
import authRoutes from "./auth/routes.js";
import categoryRoutes from "./categories/routes.js";
import transactionRoutes from "./transactions/routes.js";
import calendarRoutes from "./calendar/routes.js";
import { initializeAlertScheduler } from "./calendar/alertScheduler.js";
dotenv.config();
const app = express();
/* ---------------------------------------------------
   🔐 SECURITY (FIXED FOR IMAGE / PDF PREVIEW)
--------------------------------------------------- */
// ✅ Helmet configured correctly
app.use(
    helmet({
        crossOriginResourcePolicy: false, // 🔥 REQUIRED for <img> / <iframe>
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                imgSrc: [
                    "'self'",
                    "data:",
                    "blob:",
                    "https://money.actecrm.com"
                ],
                mediaSrc: [
                    "'self'",
                    "blob:",
                    "https://money.actecrm.com"
                ],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                connectSrc: ["'self'", "https://money.actecrm.com"],
                frameSrc: [
                    "'self'",
                    "blob:",
                    "https://money.actecrm.com"
                ],
            },
        },
    })
);
// ✅ REQUIRED: Allow cross-origin loading of static assets
app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
});
/* ---------------------------------------------------
   🧠 BODY & COOKIES
--------------------------------------------------- */
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
app.use(cookieParser());
/* ---------------------------------------------------
   🌍 CORS
--------------------------------------------------- */
app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "https://money.actecrm.com",
        ],
        credentials: true,
    })
);
/* ---------------------------------------------------
   📁 STATIC UPLOADS (🔥 FIXED)
--------------------------------------------------- */
app.use(
    "/uploads",
    express.static(path.resolve("uploads"), {
        setHeaders(res) {
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
            res.setHeader("Access-Control-Allow-Origin", "*");
        },
    })
);
/* ---------------------------------------------------
   🚀 API ROUTES
--------------------------------------------------- */
app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/calendar", calendarRoutes);
/* ---------------------------------------------------
   ❤️ HEALTH CHECK
--------------------------------------------------- */
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
/* ---------------------------------------------------
   ▶️ START SERVER
--------------------------------------------------- */
const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
    initializeAlertScheduler();
});