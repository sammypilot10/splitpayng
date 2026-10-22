export type UserRole = 'MEMBER' | 'HOST' | 'ADMIN';

// Aligned with Prisma: ACTIVE, FULL, CLOSED (removed PAUSED, ARCHIVED)
export type PoolStatus = 'ACTIVE' | 'FULL' | 'CLOSED';

export type PoolType = 'PUBLIC' | 'PRIVATE';

// Aligned with Prisma: ACTIVE, IN_ESCROW, DISPUTED, CANCELLED, FAILED (removed PENDING)
export type MembershipStatus = 'ACTIVE' | 'IN_ESCROW' | 'DISPUTED' | 'CANCELLED' | 'FAILED';

export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

// Aligned with Prisma: JOIN, RECURRING, PAYOUT (added PAYOUT)
export type TransactionType = 'JOIN' | 'RECURRING' | 'PAYOUT';

// Aligned with Prisma: PENDING, SCHEDULED, PROCESSING, COMPLETED, FAILED (added SCHEDULED, COMPLETED; removed SUCCESS)
export type PayoutStatus = 'PENDING' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type DisputeStatus = 'OPEN' | 'RESOLVED';
export type DisputeResolution = 'REFUND' | 'CONFIRM_ACCESS';

export interface User {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    emailVerified?: boolean;
    reputationScore?: number;
    successfulPools?: number;
    totalDisputes?: number;
    totalMembersServed?: number;
    hostSince?: string | null;
    createdAt: string;
}

export interface Pool {
    id: string;
    hostId: string;
    name: string;
    category: string;
    poolType: PoolType;
    totalSeats: number;
    pricePerSeat: number;
    renewalDay: number;
    encryptedCredentials: string;
    status: PoolStatus;
    createdAt: string;
    host?: User;
    _count?: { memberships: number };
}

export interface PoolPublic {
    id: string;
    hostId: string;
    name: string;
    category: string;
    poolType: string;
    totalSeats: number;
    pricePerSeat: number;
    renewalDay: number | null;
    status: string;
    createdAt: string;
    seatsTaken: number;
    seatsAvailable: number;
    hostName: string;
    escrowHours: number;
    hostReputation?: {
        score: number;
        successfulPools: number;
        totalDisputes: number;
        totalMembersServed: number;
    };
}

export interface Membership {
    id: string;
    userId: string;
    poolId: string;
    status: MembershipStatus;
    escrowEndsAt: string | null;
    nextBillingDate: string | null;
    paystackAuthCode: string | null;
    createdAt: string;
    pool?: Pool;
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export interface AuthUser {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    emailVerified?: boolean;
    reputationScore?: number;
    successfulPools?: number;
    totalDisputes?: number;
    totalMembersServed?: number;
    hostSince?: string | null;
}

export interface RegisterRequest {
    fullName: string;
    email: string;
    password: string;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface MagicLinkRequest {
    email: string;
}

// FIXED: Frontend encrypts credentials before sending — backend receives encryptedCredentials string
export interface CreatePoolRequest {
    name: string;
    category: string;
    poolType: PoolType;
    totalSeats: number;
    pricePerSeat: number;
    renewalDay: number;
    encryptedCredentials: string;
}

export interface JoinPoolRequest {
    poolId: string;
}

export interface DecryptCredentialsRequest {
    encryptionPassword: string;
}

export interface PayoutSetupRequest {
    bankCode: string;
    bankName: string;
    accountNumber: string;
}

export interface ResolveDisputeRequest {
    action: DisputeResolution;
    adminNotes?: string;
}

export interface RetryPaymentRequest {
    membershipId: string;
    useSavedCard: boolean;
}

export interface ConfirmAccessRequest {
    membershipId: string;
}

export interface RaiseDisputeRequest {
    membershipId: string;
    reason: string;
}

export interface DisputeMessageRequest {
    message: string;
}

export interface BankAccount {
    id: string;
    userId: string;
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
    recipientCode: string;
    verified: boolean;
}

export interface Transaction {
    id: string;
    reference: string;
    amount: number;
    platformFee: number;
    hostPayout: number;
    status: TransactionStatus;
    type: TransactionType;
    createdAt: string;
}

export interface Payout {
    id: string;
    transactionId: string;
    hostId: string;
    amount: number;
    status: PayoutStatus;
    payoutDueAt: string | null;
    transferCode: string | null;
    failureReason: string | null;
}

export interface Notification {
    id: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
    createdAt: string;
}

export interface DisputeEvidence {
    id: string;
    fileUrl: string;
    fileName: string;
    role: string;
    createdAt: string;
}

export interface PaymentMethod {
    id: string;
    cardType: string;
    last4: string;
    expMonth: string;
    expYear: string;
    bank: string | null;
    brand: string | null;
    isDefault: boolean;
    createdAt: string;
}