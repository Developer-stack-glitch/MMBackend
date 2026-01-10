import { pool } from "../config/dbconfig.js";

/**
 * Add a new calendar event
 */
export const addEvent = async (req, res) => {
    try {
        const { title, description, event_date, notes, category } = req.body;
        const user_id = req.user.id;

        if (!title || !event_date) {
            return res.status(400).json({
                success: false,
                message: "Title and event date are required"
            });
        }

        // Validate date format
        const eventDate = new Date(event_date);
        if (isNaN(eventDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid date format"
            });
        }

        const [result] = await pool.query(
            `INSERT INTO calendar_events 
            (user_id, title, description, event_date, notes, category, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [user_id, title, description || null, event_date, notes || null, category || 'general']
        );

        res.status(201).json({
            success: true,
            message: "Event added successfully",
            event_id: result.insertId
        });
    } catch (error) {
        console.error("Error adding event:", error);
        res.status(500).json({
            success: false,
            message: "Failed to add event"
        });
    }
};

/**
 * Get all events for a user
 */
export const getEvents = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { start_date, end_date, category } = req.query;

        let query = `
            SELECT 
                id, title, description, event_date, notes, category, status,
                alert_sent, is_deleted, created_at, updated_at
            FROM calendar_events 
            WHERE user_id = ? AND is_deleted = 0
        `;
        const params = [user_id];

        if (start_date && end_date) {
            query += ` AND event_date BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        }

        if (category) {
            query += ` AND category = ?`;
            params.push(category);
        }

        query += ` ORDER BY event_date ASC`;

        const [events] = await pool.query(query, params);

        res.json({
            success: true,
            events
        });
    } catch (error) {
        console.error("Error fetching events:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch events"
        });
    }
};

/**
 * Get a single event by ID
 */
export const getEventById = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const [events] = await pool.query(
            `SELECT * FROM calendar_events 
            WHERE id = ? AND user_id = ? AND is_deleted = 0`,
            [id, user_id]
        );

        if (events.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        res.json({
            success: true,
            event: events[0]
        });
    } catch (error) {
        console.error("Error fetching event:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch event"
        });
    }
};

/**
 * Update an event
 */
export const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, event_date, notes, category } = req.body;
        const user_id = req.user.id;

        // Check if event exists and belongs to user
        const [existing] = await pool.query(
            `SELECT id FROM calendar_events WHERE id = ? AND user_id = ? AND is_deleted = 0`,
            [id, user_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        const updates = [];
        const params = [];

        if (title !== undefined) {
            updates.push("title = ?");
            params.push(title);
        }
        if (description !== undefined) {
            updates.push("description = ?");
            params.push(description);
        }
        if (event_date !== undefined) {
            updates.push("event_date = ?");
            params.push(event_date);
            // Reset alert_sent when date is changed
            updates.push("alert_sent = 0");
        }
        if (notes !== undefined) {
            updates.push("notes = ?");
            params.push(notes);
        }
        if (category !== undefined) {
            updates.push("category = ?");
            params.push(category);
        }

        updates.push("updated_at = NOW()");
        params.push(id, user_id);

        await pool.query(
            `UPDATE calendar_events SET ${updates.join(", ")} 
            WHERE id = ? AND user_id = ?`,
            params
        );

        res.json({
            success: true,
            message: "Event updated successfully"
        });
    } catch (error) {
        console.error("Error updating event:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update event"
        });
    }
};

/**
 * Delete an event (soft delete)
 */
export const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        console.log(`Attempting to delete event - ID: ${id}, User ID: ${user_id}`);

        const [result] = await pool.query(
            `UPDATE calendar_events 
            SET is_deleted = 1, updated_at = NOW() 
            WHERE id = ? AND user_id = ? AND is_deleted = 0`,
            [id, user_id]
        );

        console.log(`Delete result - Affected rows: ${result.affectedRows}`);

        if (result.affectedRows === 0) {
            console.log(`Event not found or already deleted - ID: ${id}`);
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        console.log(`Event deleted successfully - ID: ${id}`);
        res.json({
            success: true,
            message: "Event deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting event:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete event"
        });
    }
};

/**
 * Move event to next day
 */
export const moveToNextDay = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const [events] = await pool.query(
            `SELECT DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date
             FROM calendar_events
             WHERE id = ? AND user_id = ? AND is_deleted = 0`,
            [id, user_id]
        );

        if (events.length === 0) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }

        const [year, month, day] = events[0].event_date.split("-").map(Number);

        // do date math manually (avoid JS Date completely)
        let newYear = year;
        let newMonth = month;
        let newDay = day + 1;

        const daysInMonth = new Date(year, month, 0).getDate();

        if (newDay > daysInMonth) {
            newDay = 1;
            newMonth++;

            if (newMonth > 12) {
                newMonth = 1;
                newYear++;
            }
        }

        const newDate = `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;

        const [result] = await pool.query(
            `UPDATE calendar_events
             SET event_date = ?, alert_sent = 0, updated_at = NOW()
             WHERE id = ? AND user_id = ?`,
            [newDate, id, user_id]
        );

        return res.json({
            success: true,
            message: "Event moved to next day",
            new_date: newDate
        });

    } catch (error) {
        console.error("Next day error:", error);
        return res.status(500).json({ success: false, message: "Failed to move event" });
    }
};

/**
 * Move event to next month (same date)
 */
export const moveToNextMonth = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const [events] = await pool.query(
            `SELECT DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date 
             FROM calendar_events 
             WHERE id = ? AND user_id = ? AND is_deleted = 0`,
            [id, user_id]
        );

        if (events.length === 0) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }

        const dateString = events[0].event_date;
        const [year, month, day] = dateString.split("-").map(Number);

        let newYear = year;
        let newMonth = month + 1;

        if (newMonth > 12) {
            newMonth = 1;
            newYear++;
        }

        const daysInNewMonth = new Date(newYear, newMonth, 0).getDate();
        const newDay = Math.min(day, daysInNewMonth);

        const newDate = `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;

        await pool.query(
            `UPDATE calendar_events
             SET event_date = ?, alert_sent = 0, updated_at = NOW()
             WHERE id = ? AND user_id = ?`,
            [newDate, id, user_id]
        );

        res.json({
            success: true,
            message: "Event moved to next month",
            new_date: newDate
        });

    } catch (error) {
        console.error("Move month error:", error);
        res.status(500).json({ success: false, message: "Failed to move event" });
    }
};

/**
 * Get pending alerts (events happening today or tomorrow that haven't been alerted)
 */
export const getPendingAlerts = async (req, res) => {
    try {
        const user_id = req.user.id;

        // Get today's date
        const today = new Date();
        const todayDate = today.toISOString().split('T')[0];

        // Get tomorrow's date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = tomorrow.toISOString().split('T')[0];

        const [alerts] = await pool.query(
            `SELECT id, title, description, event_date, notes, category, status
            FROM calendar_events 
            WHERE user_id = ? 
            AND (DATE(event_date) = ? OR DATE(event_date) = ?)
            AND alert_sent = 0 
            AND is_deleted = 0
            AND (status IS NULL OR status != 'completed')
            ORDER BY event_date ASC`,
            [user_id, todayDate, tomorrowDate]
        );

        res.json({
            success: true,
            alerts,
            count: alerts.length
        });
    } catch (error) {
        console.error("Error fetching pending alerts:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch alerts"
        });
    }
};

/**
 * Mark alert as sent
 */
export const markAlertSent = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        await pool.query(
            `UPDATE calendar_events 
            SET alert_sent = 1, updated_at = NOW() 
            WHERE id = ? AND user_id = ?`,
            [id, user_id]
        );

        res.json({
            success: true,
            message: "Alert marked as sent"
        });
    } catch (error) {
        console.error("Error marking alert as sent:", error);
        res.status(500).json({
            success: false,
            message: "Failed to mark alert"
        });
    }
};

/**
 * Get events by date range (for calendar view)
 */
export const getEventsByDateRange = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({
                success: false,
                message: "Month and year are required"
            });
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        const [events] = await pool.query(
            `SELECT id, title, description, event_date, notes, category, alert_sent
            FROM calendar_events 
            WHERE user_id = ? 
            AND event_date BETWEEN ? AND ? 
            AND is_deleted = 0
            ORDER BY event_date ASC`,
            [user_id, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
        );

        res.json({
            success: true,
            events
        });
    } catch (error) {
        console.error("Error fetching events by date range:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch events"
        });
    }
};

/**
 * Search events by title or notes
 */
export const searchEvents = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: "Search query is required"
            });
        }

        const [events] = await pool.query(
            `SELECT id, title, description, event_date, notes, category
            FROM calendar_events 
            WHERE user_id = ? 
            AND is_deleted = 0
            AND (title LIKE ? OR notes LIKE ? OR description LIKE ?)
            ORDER BY event_date ASC`,
            [user_id, `%${query}%`, `%${query}%`, `%${query}%`]
        );

        res.json({
            success: true,
            events,
            count: events.length
        });
    } catch (error) {
        console.error("Error searching events:", error);
        res.status(500).json({
            success: false,
            message: "Failed to search events"
        });
    }
};

/**
 * Mark event as completed
 */
export const markEventCompleted = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        // Check if event exists and belongs to user
        const [existing] = await pool.query(
            `SELECT id FROM calendar_events WHERE id = ? AND user_id = ? AND is_deleted = 0`,
            [id, user_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        // Mark as completed
        await pool.query(
            `UPDATE calendar_events 
            SET status = 'completed', updated_at = NOW() 
            WHERE id = ? AND user_id = ?`,
            [id, user_id]
        );

        res.json({
            success: true,
            message: "Event marked as completed"
        });
    } catch (error) {
        console.error("Error marking event as completed:", error);
        res.status(500).json({
            success: false,
            message: "Failed to mark event as completed"
        });
    }
};
