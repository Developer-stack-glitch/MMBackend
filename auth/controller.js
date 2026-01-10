import { pool } from "../config/dbconfig.js";   // ✅ FIXED
import jwt from "jsonwebtoken";

const signToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

const setAuthCookie = (res, token) => {
    res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 * 7,
    });
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const [rows] = await pool.query(
            "SELECT id, name, email, password_hash, role, avatar_url FROM users WHERE email = ? LIMIT 1",
            [email]
        );

        if (!rows.length) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = rows[0];

        if (password !== user.password_hash) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // ✅ Token must include role
        const token = signToken({
            id: user.id,
            role: user.role,
        });

        return res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                avatar_url: user.avatar_url
            },
            token
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Server error" });
    }
};


export const logout = async (req, res) => {
    try {
        res.clearCookie("token", {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
        });

        return res.json({ message: "Logged out successfully" });
    } catch (e) {
        console.error("LOGOUT ERROR:", e);
        return res.status(500).json({ error: "Server error" });
    }
};


export const getUser = async (req, res) => {
    try {
        const userId = req.user.id;

        const [rows] = await pool.query(
            "SELECT id, name, email, avatar_url, role FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.json(rows[0]);

    } catch (e) {
        console.error("GET USER ERROR:", e);
        return res.status(500).json({ error: "Server error" });
    }
};
