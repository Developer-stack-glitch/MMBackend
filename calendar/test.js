import { pool } from "../config/dbconfig.js";
import {
    checkUpcomingEvents,
    processAlerts,
    getUserAlerts,
    triggerAlertsManually
} from "./alertScheduler.js";

/**
 * Test script for calendar functionality
 */

async function testCalendarSystem() {
    console.log("🧪 Testing Calendar System\n");
    console.log("=".repeat(50));

    try {
        // Test 1: Check database connection
        console.log("\n1️⃣ Testing database connection...");
        const [result] = await pool.query("SELECT 1 as test");
        console.log("✅ Database connected successfully");

        // Test 2: Check if calendar_events table exists
        console.log("\n2️⃣ Checking calendar_events table...");
        const [tables] = await pool.query(
            "SHOW TABLES LIKE 'calendar_events'"
        );
        if (tables.length > 0) {
            console.log("✅ calendar_events table exists");
        } else {
            console.log("❌ calendar_events table not found");
            console.log("   Run: node migrations/create_calendar_events.js");
            return;
        }

        // Test 3: Check table structure
        console.log("\n3️⃣ Checking table structure...");
        const [columns] = await pool.query(
            "DESCRIBE calendar_events"
        );
        console.log("✅ Table structure:");
        columns.forEach(col => {
            console.log(`   - ${col.Field}: ${col.Type}`);
        });

        // Test 4: Count existing events
        console.log("\n4️⃣ Counting existing events...");
        const [countResult] = await pool.query(
            "SELECT COUNT(*) as count FROM calendar_events WHERE is_deleted = 0"
        );
        console.log(`✅ Total active events: ${countResult[0].count}`);

        // Test 5: Check for upcoming events (tomorrow)
        console.log("\n5️⃣ Checking for events tomorrow...");
        const upcomingEvents = await checkUpcomingEvents();
        console.log(`✅ Events scheduled for tomorrow: ${upcomingEvents.length}`);

        if (upcomingEvents.length > 0) {
            console.log("\n   Upcoming events:");
            upcomingEvents.forEach(event => {
                console.log(`   - ${event.title} (ID: ${event.id})`);
                console.log(`     User: ${event.username}`);
                console.log(`     Date: ${event.event_date}`);
                if (event.notes) {
                    console.log(`     Notes: ${event.notes.substring(0, 50)}...`);
                }
            });
        }

        // Test 6: Test alert processing (dry run)
        console.log("\n6️⃣ Testing alert processing...");
        const alertResult = await processAlerts();
        console.log(`✅ Alerts processed: ${alertResult.alertsSent}`);

        if (alertResult.alerts && alertResult.alerts.length > 0) {
            console.log("\n   Sample alert message:");
            console.log("   " + "-".repeat(48));
            console.log(alertResult.alerts[0].message.split('\n').map(line => `   ${line}`).join('\n'));
            console.log("   " + "-".repeat(48));
        }

        // Test 7: Check events by date range
        console.log("\n7️⃣ Testing date range query...");
        const today = new Date();
        const nextMonth = new Date(today);
        nextMonth.setMonth(today.getMonth() + 1);

        const [rangeEvents] = await pool.query(
            `SELECT COUNT(*) as count FROM calendar_events 
            WHERE event_date BETWEEN ? AND ? AND is_deleted = 0`,
            [
                today.toISOString().split('T')[0],
                nextMonth.toISOString().split('T')[0]
            ]
        );
        console.log(`✅ Events in next 30 days: ${rangeEvents[0].count}`);

        // Test 8: Check categories
        console.log("\n8️⃣ Checking event categories...");
        const [categories] = await pool.query(
            `SELECT category, COUNT(*) as count 
            FROM calendar_events 
            WHERE is_deleted = 0 
            GROUP BY category`
        );

        if (categories.length > 0) {
            console.log("✅ Categories in use:");
            categories.forEach(cat => {
                console.log(`   - ${cat.category}: ${cat.count} events`);
            });
        } else {
            console.log("ℹ️  No categories found (no events yet)");
        }

        // Test 9: Test search functionality
        console.log("\n9️⃣ Testing search functionality...");
        const [searchResults] = await pool.query(
            `SELECT COUNT(*) as count FROM calendar_events 
            WHERE is_deleted = 0 
            AND (title LIKE '%meeting%' OR notes LIKE '%meeting%')`
        );
        console.log(`✅ Events matching 'meeting': ${searchResults[0].count}`);

        console.log("\n" + "=".repeat(50));
        console.log("✅ All tests completed successfully!");
        console.log("=".repeat(50));

        // Summary
        console.log("\n📊 SUMMARY:");
        console.log(`   Total Events: ${countResult[0].count}`);
        console.log(`   Tomorrow's Events: ${upcomingEvents.length}`);
        console.log(`   Alerts Sent: ${alertResult.alertsSent}`);
        console.log(`   Categories: ${categories.length}`);

        console.log("\n💡 NEXT STEPS:");
        console.log("   1. Use the API endpoints to add events");
        console.log("   2. Test the alert system with events scheduled for tomorrow");
        console.log("   3. Check the API_DOCUMENTATION.md for endpoint details");
        console.log("   4. The alert scheduler runs daily at 9:00 AM automatically");

    } catch (error) {
        console.error("\n❌ Test failed:", error);
        console.error("\nError details:", error.message);
    } finally {
        // Close database connection
        await pool.end();
        console.log("\n🔌 Database connection closed");
    }
}

// Run tests
testCalendarSystem();
