import { useState, useRef, useEffect, useMemo } from 'react';
import {
    Bell, Check, CheckCheck, Loader2, Key, AlertTriangle,
    CheckCircle2, XCircle, Clock, Trash2, X, Inbox, UserPlus
} from 'lucide-react';
import { useNotifications, type Notification } from '../hooks/useNotifications';

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearRead,
        refetch,
    } = useNotifications();

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 172800) return 'yesterday';
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const getNotificationIcon = (type: string) => {
        const lower = (type || '').toLowerCase();
        if (lower.includes('credential')) {
            return (
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <Key size={14} />
                </div>
            );
        }
        if (lower.includes('dispute')) {
            return (
                <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                    <AlertTriangle size={14} />
                </div>
            );
        }
        if (lower.includes('failed') || lower.includes('error')) {
            return (
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                    <XCircle size={14} />
                </div>
            );
        }
        if (lower.includes('join') || lower.includes('member')) {
            return (
                <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <UserPlus size={14} />
                </div>
            );
        }
        if (lower.includes('pay') || lower.includes('success')) {
            return (
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={14} />
                </div>
            );
        }
        if (lower.includes('billing') || lower.includes('escrow') || lower.includes('reminder')) {
            return (
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                    <Clock size={14} />
                </div>
            );
        }
        return (
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                <Bell size={14} />
            </div>
        );
    };

    const displayedNotifications = useMemo(() => {
        if (filter === 'unread') {
            return notifications.filter((n) => !n.read);
        }
        return notifications;
    }, [notifications, filter]);

    const hasReadNotifications = useMemo(() => {
        return notifications.some((n) => n.read);
    }, [notifications]);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => {
                    setOpen(!open);
                    if (!open) refetch();
                }}
                className="relative p-2 rounded-xl bg-[#151722] border border-[#26293b] text-slate-300 hover:text-white hover:border-slate-500 transition-colors focus:outline-none"
                aria-label="Notifications"
                title="Notifications"
            >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center border-2 border-[#0b0c10] shadow-sm">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 mt-3 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-[#0e1017]/95 backdrop-blur-xl border border-[#26293b] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] z-50 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3.5 border-b border-[#26293b]/80 bg-[#13141f]/70">
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-bold text-white">Notifications</h3>
                                {unreadCount > 0 && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                                        {unreadCount} new
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                                        title="Mark all as read"
                                    >
                                        <CheckCheck className="w-3.5 h-3.5" />
                                        <span>Mark all read</span>
                                    </button>
                                )}
                                {hasReadNotifications && (
                                    <button
                                        onClick={clearRead}
                                        className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
                                        title="Clear read notifications"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        <span>Clear read</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Filter Tabs */}
                        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0a0b10] border border-[#26293b]">
                            <button
                                onClick={() => setFilter('all')}
                                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-all ${
                                    filter === 'all'
                                        ? 'bg-[#1b1e2c] text-white shadow-sm'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                All ({notifications.length})
                            </button>
                            <button
                                onClick={() => setFilter('unread')}
                                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-all ${
                                    filter === 'unread'
                                        ? 'bg-[#1b1e2c] text-white shadow-sm'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                Unread ({unreadCount})
                            </button>
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-[#26293b]/50">
                        {loading && notifications.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                                <Loader2 className="w-6 h-6 text-indigo-400 animate-spin mb-2" />
                                <span className="text-xs">Loading notifications...</span>
                            </div>
                        )}

                        {!loading && displayedNotifications.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                                <div className="w-12 h-12 rounded-2xl bg-[#151722] border border-[#26293b] flex items-center justify-center text-slate-500 mb-2.5">
                                    <Inbox size={20} />
                                </div>
                                <p className="text-xs font-medium text-slate-300">
                                    {filter === 'unread' ? 'All caught up!' : 'No notifications yet'}
                                </p>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                    {filter === 'unread'
                                        ? 'You have read all your notifications.'
                                        : 'Account updates, payment alerts, and password shares will show up here.'}
                                </p>
                            </div>
                        )}

                        {displayedNotifications.map((n: Notification) => (
                            <div
                                key={n.id}
                                onClick={() => !n.read && markAsRead(n.id)}
                                className={`group relative p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                                    n.read
                                        ? 'bg-transparent hover:bg-[#151722]/50'
                                        : 'bg-indigo-500/5 hover:bg-indigo-500/10'
                                }`}
                            >
                                {getNotificationIcon(n.type)}

                                <div className="flex-1 min-w-0 pr-6">
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-xs font-semibold text-white truncate">
                                            {n.title}
                                        </p>
                                        {!n.read && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed break-words line-clamp-2">
                                        {n.message}
                                    </p>
                                    <span className="text-[10px] text-slate-500 mt-1 block">
                                        {formatTime(n.createdAt)}
                                    </span>
                                </div>

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteNotification(n.id);
                                    }}
                                    className="absolute top-3.5 right-3 text-slate-600 hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                    title="Delete notification"
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                        <div className="px-4 py-2 border-t border-[#26293b]/70 bg-[#0b0c10]/60 flex items-center justify-between text-[10px] text-slate-500">
                            <span>Showing recent updates</span>
                            {unreadCount === 0 && (
                                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                                    <Check size={11} /> Up to date
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}