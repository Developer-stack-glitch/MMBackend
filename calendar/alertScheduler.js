import { pool } from "../config/dbconfig.js";
import cron from "node-cron";

/**
 * Check for events happening tomorrow and return alerts
 */
export async function checkUpcomingEvents() {
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = tomorrow.toISOString().split('T')[0];

        const [events] = await pool.query(
            `SELECT 
                ce.id, ce.user_id, ce.title, ce.description, 
                ce.event_date, ce.notes, ce.category,
                u.username, u.email
            FROM calendar_events ce
            JOIN users u ON ce.user_id = u.id
            WHERE DATE(ce.event_date) = ? 
            AND ce.alert_sent = 0 
            AND ce.is_deleted = 0`,
            [tomorrowDate]
        );

        console.log(`Found ${events.length} events for tomorrow (${tomorrowDate})`);
        return events;
    } catch (error) {
        console.error("Error checking upcoming events:", error);
        return [];
    }
}

/**
 * Mark event alert as sent
 */
export async function markEventAlertSent(eventId) {
    try {
        await pool.query(
            `UPDATE calendar_events 
            SET alert_sent = 1, updated_at = NOW() 
            WHERE id = ?`,
            [eventId]
        );
        console.log(`✅ Alert marked as sent for event ID: ${eventId}`);
    } catch (error) {
        console.error(`Error marking alert as sent for event ${eventId}:`, error);
    }
}

/**
 * Format alert message for an event
 */
export function formatAlertMessage(event) {
    const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let message = `🔔 Event Reminder\n\n`;
    message += `📅 Tomorrow: ${eventDate}\n`;
    message += `📌 ${event.title}\n`;

    if (event.description) {
        message += `📝 ${event.description}\n`;
    }

    if (event.notes) {
        message += `\n📋 Notes:\n${event.notes}\n`;
    }

    message += `\n🔗 Event ID: ${event.id}\n`;
    message += `\nActions available:\n`;
    message += `• Cancel (Delete)\n`;
    message += `• Move to Next Day\n`;
    message += `• Move to Next Month (Same Date)\n`;

    return message;
}

/**
 * Process and send alerts
 * This function should be called by a cron job or manually
 */
export async function processAlerts() {
    console.log("🔍 Checking for upcoming events...");

    const events = await checkUpcomingEvents();

    if (events.length === 0) {
        console.log("No alerts to send.");
        return { success: true, alertsSent: 0 };
    }

    const alerts = [];

    for (const event of events) {
        const alertData = {
            event_id: event.id,
            user_id: event.user_id,
            username: event.username,
            email: event.email,
            title: event.title,
            description: event.description,
            event_date: event.event_date,
            notes: event.notes,
            category: event.category,
            message: formatAlertMessage(event),
            timestamp: new Date().toISOString()
        };

        alerts.push(alertData);

        // Mark as sent
        await markEventAlertSent(event.id);

        console.log(`📧 Alert prepared for: ${event.username} - ${event.title}`);
    }

    return {
        success: true,
        alertsSent: alerts.length,
        alerts
    };
}

/**
 * Initialize alert scheduler
 * Runs every day at 9:00 AM
 */
export function initializeAlertScheduler() {
    // Run every day at 9:00 AM
    cron.schedule('0 9 * * *', async () => {
        console.log('⏰ Running scheduled alert check...');
        await processAlerts();
    });

    console.log('✅ Alert scheduler initialized (runs daily at 9:00 AM)');
}

/**
 * Get all alerts for a specific user
 */
export async function getUserAlerts(userId) {
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = tomorrow.toISOString().split('T')[0];

        const [events] = await pool.query(
            `SELECT id, title, description, event_date, notes, category, alert_sent
            FROM calendar_events 
            WHERE user_id = ? 
            AND DATE(event_date) = ? 
            AND is_deleted = 0`,
            [userId, tomorrowDate]
        );

        return events.map(event => ({
            event_id: event.id,
            title: event.title,
            description: event.description,
            event_date: event.event_date,
            notes: event.notes,
            category: event.category,
            alert_sent: event.alert_sent,
            message: formatAlertMessage(event)
        }));
    } catch (error) {
        console.error("Error getting user alerts:", error);
        return [];
    }
}

/**
 * Manual trigger for testing
 */
export async function triggerAlertsManually() {
    console.log("🔧 Manually triggering alerts...");
    return await processAlerts();
}
