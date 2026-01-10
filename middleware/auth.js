import jwt from "jsonwebtoken";
import { pool } from "../config/dbconfig.js";

/**
 * ------------------------------------------------
 * VERIFY TOKEN (Load Full User)
 * ------------------------------------------------
 * - Validates JWT
 * - Fetches user from DB
 * - Attaches: req.user = { id, name, role }
 * ------------------------------------------------
 */
export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    try {
        // Decode token (contains only {id, role})
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch full user details
        const [[user]] = await pool.query(
            "SELECT id, name, role FROM users WHERE id = ? LIMIT 1",
            [decoded.id]
        );

        if (!user) {
            return res.status(401).json({ error: "User not found" });
        }

        // Attach full user to request
        req.user = {
            id: user.id,
            name: user.name,
            role: user.role,
        };

        next();

    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
};


/**
 * ------------------------------------------------
 * VERIFY ADMIN
 * ------------------------------------------------
 * - Checks if req.user.role === "admin"
 * ------------------------------------------------
 */
export const verifyAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ error: "Admin only" });
    }
    next();
};
