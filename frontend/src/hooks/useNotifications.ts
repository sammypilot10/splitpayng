import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export interface Notification {
    id: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
    createdAt: string;
    data?: any;
}

export function useNotifications() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);

    const fetchNotifications = useCallback(async () => {
        setLoading(true);
        try {
            const res: any = await api.get('/notifications');
            setNotifications(res.data || []);
        } catch {
            // silently fail
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchUnreadCount = useCallback(async () => {
        try {
            const res: any = await api.get('/notifications/unread-count');
            setUnreadCount(res.data?.count || 0);
        } catch {
            setUnreadCount(0);
        }
    }, []);

    const markAsRead = useCallback(async (id: string) => {
        try {
            await api.post(`/notifications/${id}/read`);
            setNotifications((prev: Notification[]) =>
                prev.map((n: Notification) => (n.id === id ? { ...n, read: true } : n))
            );
            setUnreadCount((c: number) => Math.max(0, c - 1));
        } catch {
            // silently fail
        }
    }, []);

    const markAllAsRead = useCallback(async () => {
        try {
            await api.post('/notifications/read-all');
            setNotifications((prev: Notification[]) => prev.map((n: Notification) => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch {
            // silently fail
        }
    }, []);

    const deleteNotification = useCallback(async (id: string) => {
        try {
            await api.delete(`/notifications/${id}`);
            setNotifications((prev: Notification[]) => prev.filter((n: Notification) => n.id !== id));
            fetchUnreadCount();
        } catch {
            // silently fail
        }
    }, [fetchUnreadCount]);

    const clearRead = useCallback(async () => {
        try {
            await api.delete('/notifications/clear-read');
            setNotifications((prev: Notification[]) => prev.filter((n: Notification) => !n.read));
        } catch {
            // silently fail
        }
    }, []);

    useEffect(() => {
        fetchNotifications();
        fetchUnreadCount();

        const interval = setInterval(() => {
            fetchUnreadCount();
        }, 30_000);

        return () => clearInterval(interval);
    }, [fetchNotifications, fetchUnreadCount]);

    return {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearRead,
        refetch: fetchNotifications,
    };
}