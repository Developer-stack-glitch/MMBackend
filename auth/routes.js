import { Router } from "express";
import { login, logout, getUser } from "./controller.js";
import { createUser, listUsers, deleteUser } from "./adminController.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";

const router = Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", verifyToken, getUser);

router.post("/create-user", verifyToken, verifyAdmin, createUser);
router.delete("/users/:id", verifyToken, verifyAdmin, deleteUser);

// ✅ Everyone logged in can access user list
router.get("/users", verifyToken, listUsers);


export default router;
