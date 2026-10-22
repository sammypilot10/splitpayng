import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import { useAuth } from '../hooks/useAuth';
import { LogOut, PlusCircle, LayoutDashboard, Shield, Menu, X, Store, BookmarkCheck, ArrowRight, Layers, Landmark, Users, CreditCard } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const handleLogout = async () => {
        await logout();
        navigate('/');
        setMobileOpen(false);
    };

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="min-h-screen bg-[#0b0c10] text-white bg-noise flex flex-col justify-between">
            {/* Header Navigation Bar */}
            <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#0b0c10]/90 backdrop-blur-md border-b border-[#26293b] py-3.5' : 'bg-transparent py-5'}`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center">
                        {/* Brand Logo */}
                        <Link to="/" className="flex items-center gap-2.5 group">
                            <div className="w-9 h-9 rounded-xl bg-[#151722] border border-[#26293b] flex items-center justify-center text-white group-hover:border-slate-500 transition-colors">
                                <Layers size={18} className="text-white" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-lg font-extrabold tracking-tight text-white">SplitPayNG</span>
                                <span className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold -mt-1">Subscription Sharing</span>
                            </div>
                        </Link>

                        {/* Desktop Nav Links */}
                        <div className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-[#151722] border border-[#26293b]">
                            <Link to="/" className={`dark-nav-link ${isActive('/') ? 'active' : ''}`}>
                                <Store size={15} className="inline mr-1.5 -mt-0.5" />
                                Marketplace
                            </Link>
                            {user && (
                                <>
                                    <Link to="/dashboard" className={`dark-nav-link ${isActive('/dashboard') ? 'active' : ''}`}>
                                        <LayoutDashboard size={15} className="inline mr-1.5 -mt-0.5" />
                                        Dashboard
                                    </Link>
                                    <Link to="/host-dashboard" className={`dark-nav-link ${isActive('/host-dashboard') ? 'active' : ''}`}>
                                        <Users size={15} className="inline mr-1.5 -mt-0.5" />
                                        My Members
                                    </Link>
                                    <Link to="/payout-setup" className={`dark-nav-link ${isActive('/payout-setup') ? 'active' : ''}`}>
                                        <Landmark size={15} className="inline mr-1.5 -mt-0.5" />
                                        Payout
                                    </Link>
                                    <Link to="/create-pool" className={`dark-nav-link ${isActive('/create-pool') ? 'active' : ''}`}>
                                        <PlusCircle size={15} className="inline mr-1.5 -mt-0.5" />
                                        Host Pool
                                    </Link>
                                    <Link to="/my-subscriptions" className={`dark-nav-link ${isActive('/my-subscriptions') ? 'active' : ''}`}>
                                        <BookmarkCheck size={15} className="inline mr-1.5 -mt-0.5" />
                                        My Subs
                                    </Link>
                                    <Link to="/payment-methods" className={`dark-nav-link ${isActive('/payment-methods') ? 'active' : ''}`}>
                                        <CreditCard size={15} className="inline mr-1.5 -mt-0.5" />
                                        Cards
                                    </Link>
                                    {user.role === 'ADMIN' && (
                                        <Link to="/admin/disputes" className={`dark-nav-link text-red-400 ${isActive('/admin/disputes') ? 'active' : ''}`}>
                                            <Shield size={15} className="inline mr-1.5 -mt-0.5" />
                                            Admin
                                        </Link>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Right Account Action Controls */}
                        <div className="hidden md:flex items-center gap-3">
                            {user ? (
                                <div className="flex items-center gap-2.5">
                                    <NotificationBell />
                                    <div className="px-3.5 py-1.5 rounded-xl bg-[#151722] border border-[#26293b] flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold border border-slate-700">
                                            {user.fullName.charAt(0)}
                                        </div>
                                        <span className="text-xs font-medium text-slate-200">{user.fullName}</span>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="btn-slate-outline !px-3 !py-2 !rounded-xl text-slate-300 hover:text-white"
                                        title="Sign Out"
                                    >
                                        <LogOut size={16} />
                                    </button>
                                </div>
                            ) : (
                                <Link to="/auth" className="btn-solid-white text-xs !px-5 !py-2.5">
                                    Sign In <ArrowRight size={14} className="inline ml-1.5" />
                                </Link>
                            )}
                        </div>

                        {/* Mobile Actions */}
                        <div className="flex items-center gap-2 md:hidden">
                            {user && <NotificationBell />}
                            <button
                                className="p-2.5 rounded-xl bg-[#151722] border border-[#26293b] text-slate-300 hover:text-white"
                                onClick={() => setMobileOpen(!mobileOpen)}
                            >
                                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile Drawer Menu */}
                {mobileOpen && (
                    <div className="md:hidden px-4 mt-3">
                        <div className="bg-[#151722] border border-[#26293b] rounded-2xl p-4 space-y-2">
                            <Link
                                to="/"
                                onClick={() => setMobileOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                            >
                                <Store size={18} /> Marketplace
                            </Link>

                            {user ? (
                                <>
                                    <Link
                                        to="/dashboard"
                                        onClick={() => setMobileOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/dashboard') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        <LayoutDashboard size={18} /> Dashboard
                                    </Link>
                                    <Link
                                        to="/host-dashboard"
                                        onClick={() => setMobileOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/host-dashboard') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        <Users size={18} /> My Members
                                    </Link>
                                    <Link
                                        to="/payout-setup"
                                        onClick={() => setMobileOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/payout-setup') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        <Landmark size={18} /> Payout
                                    </Link>
                                    <Link
                                        to="/create-pool"
                                        onClick={() => setMobileOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/create-pool') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        <PlusCircle size={18} /> Host Pool
                                    </Link>
                                    <Link
                                        to="/my-subscriptions"
                                        onClick={() => setMobileOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/my-subscriptions') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        <BookmarkCheck size={18} /> My Subscriptions
                                    </Link>
                                    <Link
                                        to="/payment-methods"
                                        onClick={() => setMobileOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive('/payment-methods') ? 'bg-[#1b1e2b] text-white border border-[#26293b]' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        <CreditCard size={18} /> Payment Methods
                                    </Link>
                                    {user.role === 'ADMIN' && (
                                        <Link
                                            to="/admin/disputes"
                                            onClick={() => setMobileOpen(false)}
                                            className="flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-white/5"
                                        >
                                            <Shield size={18} /> Admin Disputes
                                        </Link>
                                    )}
                                    <div className="pt-3 border-t border-[#26293b] flex items-center justify-between">
                                        <span className="text-xs text-slate-400">Signed in as <strong className="text-white">{user.fullName}</strong></span>
                                        <button
                                            onClick={handleLogout}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold"
                                        >
                                            <LogOut size={14} /> Logout
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <Link
                                    to="/auth"
                                    onClick={() => setMobileOpen(false)}
                                    className="w-full btn-solid-white text-center mt-2 py-3"
                                >
                                    Sign In / Register
                                </Link>
                            )}
                        </div>
                    </div>
                )}
            </header>

            {/* Main Page Area */}
            <main className="pt-28 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full flex-grow">
                <Outlet />
            </main>

            {/* Professional Footer */}
            <footer className="border-t border-[#26293b] py-8 bg-[#0e1017]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Layers size={18} className="text-slate-400" />
                        <span className="text-sm font-bold text-white">SplitPayNG</span>
                        <span className="text-xs text-slate-500">© 2026. Automated Escrow Subscription Sharing.</span>
                    </div>
                    <div className="flex items-center gap-6 text-xs text-slate-400">
                        <Link to="/" className="hover:text-white transition-colors">Marketplace</Link>
                        <Link to="/auth" className="hover:text-white transition-colors">Security & Escrow</Link>
                        <Link to="/create-pool" className="hover:text-white transition-colors">Host a Pool</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}