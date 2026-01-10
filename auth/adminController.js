import { pool } from "../config/dbconfig.js";

export const createUser = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // ✅ Only admin can create user
        if (req.user.role !== "admin") {
            return res.status(403).json({ error: "You don't have permission to create users." });
        }

        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const [existing] = await pool.query(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [email]
        );

        if (existing.length) {
            return res.status(400).json({ error: "Email already exists" });
        }

        const [result] = await pool.query(
            "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, NOW())",
            [name, email, password, role]
        );

        return res.json({
            message: "User created successfully",
            userId: result.insertId
        });

    } catch (e) {
        console.error("ADMIN CREATE USER ERROR:", e);
        return res.status(500).json({ error: "Server error" });
    }
};

export const listUsers = async (_req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT id, name, email, role, created_at FROM users ORDER BY id DESC"
        );
        return res.json(rows);
    } catch (e) {
        console.error("ADMIN LIST USERS ERROR:", e);
        return res.status(500).json({ error: "Server error" });
    }
};

export const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        // ✅ Only admin can delete users
        if (req.user.role !== "admin") {
            return res.status(403).json({ error: "You do not have permission to delete users." });
        }

        // prevent deleting yourself
        if (Number(id) === Number(req.user.id)) {
            return res.status(400).json({ error: "You cannot delete your own account." });
        }

        // Check role of target user
        const [target] = await pool.query(
            "SELECT id, role FROM users WHERE id = ? LIMIT 1",
            [id]
        );

        if (!target.length) {
            return res.status(404).json({ error: "User not found" });
        }

        // ✅ Admin cannot delete another admin
        if (target[0].role === "admin") {
            return res.status(403).json({ error: "Admin users cannot be deleted." });
        }

        // ✅ Delete user
        await pool.query("DELETE FROM users WHERE id = ?", [id]);

        return res.json({ message: "User deleted" });

    } catch (e) {
        console.error("ADMIN DELETE USER ERROR:", e);
        return res.status(500).json({ error: "Server error" });
    }
};
