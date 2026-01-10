import express from "express";
import {
    addEvent,
    getEvents,
    getEventById,
    updateEvent,
    deleteEvent,
    moveToNextDay,
    moveToNextMonth,
    getPendingAlerts,
    markAlertSent,
    getEventsByDateRange,
    searchEvents,
    markEventCompleted
} from "./controller.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// Event CRUD operations
router.post("/add-event", verifyToken, addEvent);
router.get("/events", verifyToken, getEvents);
router.get("/event/:id", verifyToken, getEventById);
router.put("/event/:id", verifyToken, updateEvent);
router.delete("/event/:id", verifyToken, deleteEvent);

// Event actions
router.post("/event/:id/move-next-day", verifyToken, moveToNextDay);
router.post("/event/:id/move-next-month", verifyToken, moveToNextMonth);
router.post("/event/:id/complete", verifyToken, markEventCompleted);

// Alerts
router.get("/pending-alerts", verifyToken, getPendingAlerts);
router.post("/alert/:id/mark-sent", verifyToken, markAlertSent);

// Calendar view
router.get("/events-by-date", verifyToken, getEventsByDateRange);
router.get("/search", verifyToken, searchEvents);

export default router;
