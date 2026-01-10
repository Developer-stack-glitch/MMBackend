// Calendar API Integration Example
// This file shows how to integrate the calendar backend with your frontend

// Base configuration
const API_BASE_URL = 'http://localhost:4000/api/calendar';

// Helper function to get auth token (adjust based on your auth implementation)
const getAuthToken = () => {
    // Example: return localStorage.getItem('token');
    return 'YOUR_JWT_TOKEN';
};

// Helper function for API calls
const apiCall = async (endpoint, options = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`,
            ...options.headers,
        },
        credentials: 'include', // Include cookies
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'API request failed');
    }

    return data;
};

// ============================================
// EVENT MANAGEMENT FUNCTIONS
// ============================================

/**
 * Create a new calendar event
 */
export const createEvent = async (eventData) => {
    try {
        const response = await apiCall('/add-event', {
            method: 'POST',
            body: JSON.stringify({
                title: eventData.title,
                description: eventData.description || '',
                event_date: eventData.date, // Format: YYYY-MM-DD
                notes: eventData.notes || '',
                category: eventData.category || 'general'
            })
        });

        console.log('Event created:', response);
        return response;
    } catch (error) {
        console.error('Error creating event:', error);
        throw error;
    }
};

/**
 * Get all events with optional filters
 */
export const getEvents = async (filters = {}) => {
    try {
        const params = new URLSearchParams();

        if (filters.startDate) params.append('start_date', filters.startDate);
        if (filters.endDate) params.append('end_date', filters.endDate);
        if (filters.category) params.append('category', filters.category);

        const queryString = params.toString();
        const endpoint = queryString ? `/events?${queryString}` : '/events';

        const response = await apiCall(endpoint);
        return response.events;
    } catch (error) {
        console.error('Error fetching events:', error);
        throw error;
    }
};

/**
 * Get a specific event by ID
 */
export const getEventById = async (eventId) => {
    try {
        const response = await apiCall(`/event/${eventId}`);
        return response.event;
    } catch (error) {
        console.error('Error fetching event:', error);
        throw error;
    }
};

/**
 * Update an existing event
 */
export const updateEvent = async (eventId, updates) => {
    try {
        const response = await apiCall(`/event/${eventId}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });

        console.log('Event updated:', response);
        return response;
    } catch (error) {
        console.error('Error updating event:', error);
        throw error;
    }
};

/**
 * Delete an event (soft delete)
 */
export const deleteEvent = async (eventId) => {
    try {
        const response = await apiCall(`/event/${eventId}`, {
            method: 'DELETE'
        });

        console.log('Event deleted:', response);
        return response;
    } catch (error) {
        console.error('Error deleting event:', error);
        throw error;
    }
};

// ============================================
// ALERT ACTION FUNCTIONS
// ============================================

/**
 * Move event to next day
 */
export const moveEventToNextDay = async (eventId) => {
    try {
        const response = await apiCall(`/event/${eventId}/move-next-day`, {
            method: 'POST'
        });

        console.log('Event moved to next day:', response.new_date);
        return response;
    } catch (error) {
        console.error('Error moving event:', error);
        throw error;
    }
};

/**
 * Move event to next month (same date)
 */
export const moveEventToNextMonth = async (eventId) => {
    try {
        const response = await apiCall(`/event/${eventId}/move-next-month`, {
            method: 'POST'
        });

        console.log('Event moved to next month:', response.new_date);
        return response;
    } catch (error) {
        console.error('Error moving event:', error);
        throw error;
    }
};

/**
 * Cancel event (delete)
 */
export const cancelEvent = async (eventId) => {
    return await deleteEvent(eventId);
};

// ============================================
// ALERT FUNCTIONS
// ============================================

/**
 * Get pending alerts (events happening tomorrow)
 */
export const getPendingAlerts = async () => {
    try {
        const response = await apiCall('/pending-alerts');
        return response.alerts;
    } catch (error) {
        console.error('Error fetching alerts:', error);
        throw error;
    }
};

/**
 * Mark alert as sent
 */
export const markAlertSent = async (eventId) => {
    try {
        const response = await apiCall(`/alert/${eventId}/mark-sent`, {
            method: 'POST'
        });
        return response;
    } catch (error) {
        console.error('Error marking alert:', error);
        throw error;
    }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get events for a specific month
 */
export const getEventsByMonth = async (month, year) => {
    try {
        const response = await apiCall(`/events-by-date?month=${month}&year=${year}`);
        return response.events;
    } catch (error) {
        console.error('Error fetching events by month:', error);
        throw error;
    }
};

/**
 * Search events by query
 */
export const searchEvents = async (query) => {
    try {
        const response = await apiCall(`/search?query=${encodeURIComponent(query)}`);
        return response.events;
    } catch (error) {
        console.error('Error searching events:', error);
        throw error;
    }
};

// ============================================
// EXAMPLE USAGE IN REACT COMPONENT
// ============================================

/*
import React, { useState, useEffect } from 'react';
import { 
    createEvent, 
    getEvents, 
    getPendingAlerts,
    moveEventToNextDay,
    moveEventToNextMonth,
    cancelEvent
} from './calendarApi';

function CalendarComponent() {
    const [events, setEvents] = useState([]);
    const [alerts, setAlerts] = useState([]);

    // Load events on component mount
    useEffect(() => {
        loadEvents();
        loadAlerts();
    }, []);

    const loadEvents = async () => {
        try {
            const eventList = await getEvents();
            setEvents(eventList);
        } catch (error) {
            console.error('Failed to load events:', error);
        }
    };

    const loadAlerts = async () => {
        try {
            const alertList = await getPendingAlerts();
            setAlerts(alertList);
        } catch (error) {
            console.error('Failed to load alerts:', error);
        }
    };

    const handleCreateEvent = async (eventData) => {
        try {
            await createEvent(eventData);
            loadEvents(); // Reload events
        } catch (error) {
            alert('Failed to create event');
        }
    };

    const handleAlertAction = async (eventId, action) => {
        try {
            switch(action) {
                case 'cancel':
                    await cancelEvent(eventId);
                    break;
                case 'nextDay':
                    await moveEventToNextDay(eventId);
                    break;
                case 'nextMonth':
                    await moveEventToNextMonth(eventId);
                    break;
            }
            loadEvents();
            loadAlerts();
        } catch (error) {
            alert('Failed to perform action');
        }
    };

    return (
        <div>
            <h1>Calendar</h1>
            
            {/* Alert Section *\/}
            {alerts.length > 0 && (
                <div className="alerts">
                    <h2>Tomorrow's Events</h2>
                    {alerts.map(alert => (
                        <div key={alert.id} className="alert-card">
                            <h3>{alert.title}</h3>
                            <p>{alert.description}</p>
                            <p>Notes: {alert.notes}</p>
                            <div className="alert-actions">
                                <button onClick={() => handleAlertAction(alert.id, 'cancel')}>
                                    Cancel
                                </button>
                                <button onClick={() => handleAlertAction(alert.id, 'nextDay')}>
                                    Move to Next Day
                                </button>
                                <button onClick={() => handleAlertAction(alert.id, 'nextMonth')}>
                                    Move to Next Month
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Events List *\/}
            <div className="events">
                <h2>All Events</h2>
                {events.map(event => (
                    <div key={event.id} className="event-card">
                        <h3>{event.title}</h3>
                        <p>{event.description}</p>
                        <p>Date: {event.event_date}</p>
                        <p>Category: {event.category}</p>
                        {event.notes && <p>Notes: {event.notes}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default CalendarComponent;
*/

// ============================================
// EXAMPLE: Creating an Event Form
// ============================================

/*
function EventForm({ onSubmit }) {
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        date: '',
        notes: '',
        category: 'general'
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        try {
            await createEvent(formData);
            onSubmit(); // Callback to refresh events
            setFormData({ title: '', description: '', date: '', notes: '', category: 'general' });
        } catch (error) {
            alert('Failed to create event');
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <input
                type="text"
                placeholder="Event Title"
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                required
            />
            
            <textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
            />
            
            <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                required
            />
            
            <textarea
                placeholder="Notes"
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
            />
            
            <select
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
            >
                <option value="general">General</option>
                <option value="work">Work</option>
                <option value="personal">Personal</option>
                <option value="health">Health</option>
                <option value="finance">Finance</option>
            </select>
            
            <button type="submit">Create Event</button>
        </form>
    );
}
*/

// ============================================
// EXAMPLE: Alert Notification Component
// ============================================

/*
function AlertNotification({ alert, onAction }) {
    return (
        <div className="alert-notification">
            <div className="alert-header">
                <span className="alert-icon">🔔</span>
                <h3>Event Tomorrow!</h3>
            </div>
            
            <div className="alert-body">
                <h4>{alert.title}</h4>
                {alert.description && <p>{alert.description}</p>}
                {alert.notes && (
                    <div className="alert-notes">
                        <strong>Notes:</strong>
                        <p>{alert.notes}</p>
                    </div>
                )}
                <p className="alert-date">
                    📅 {new Date(alert.event_date).toLocaleDateString()}
                </p>
            </div>
            
            <div className="alert-actions">
                <button 
                    className="btn-danger"
                    onClick={() => onAction(alert.id, 'cancel')}
                >
                    ❌ Cancel
                </button>
                <button 
                    className="btn-primary"
                    onClick={() => onAction(alert.id, 'nextDay')}
                >
                    ➡️ Next Day
                </button>
                <button 
                    className="btn-secondary"
                    onClick={() => onAction(alert.id, 'nextMonth')}
                >
                    📆 Next Month
                </button>
            </div>
        </div>
    );
}
*/

export default {
    createEvent,
    getEvents,
    getEventById,
    updateEvent,
    deleteEvent,
    moveEventToNextDay,
    moveEventToNextMonth,
    cancelEvent,
    getPendingAlerts,
    markAlertSent,
    getEventsByMonth,
    searchEvents
};
