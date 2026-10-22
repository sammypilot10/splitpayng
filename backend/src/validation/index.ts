import { z } from 'zod';

// ─── Shared ────────────────────────────────────────────────────────────────

export const idParamSchema = z.object({
    id: z.string().min(1, 'ID is required'),
});

// ─── Auth ──────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Invalid email address'),
    password: z
        .string()
        .min(1, 'Password is required')
        .min(8, 'Password must be at least 8 characters'),
    fullName: z
        .string()
        .min(1, 'Full name is required')
        .min(2, 'Full name must be at least 2 characters')
        .max(100, 'Full name must be at most 100 characters'),
});

export const loginSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

export const magicLinkSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Invalid email address'),
});

export const verifyMagicLinkSchema = z.object({
    token: z.string().min(1, 'Token is required'),
});

export const forgotPasswordSchema = z.object({
    email: z.string().min(1, 'Email is required').email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    password: z
        .string()
        .min(1, 'Password is required')
        .min(8, 'Password must be at least 8 characters'),
});

export const verifyEmailSchema = z.object({
    token: z.string().min(1, 'Verification token is required'),
});

// ─── Pools ─────────────────────────────────────────────────────────────────

export const createPoolSchema = z.object({
    name: z
        .string()
        .min(1, 'Pool name is required')
        .min(2, 'Pool name must be at least 2 characters')
        .max(100, 'Pool name must be at most 100 characters'),
    category: z
        .string()
        .min(1, 'Category is required')
        .min(2, 'Category must be at least 2 characters'),
    totalSeats: z.coerce
        .number()
        .int('Total seats must be a whole number')
        .min(2, 'Total seats must be at least 2')
        .max(20, 'Total seats must be at most 20'),
    pricePerSeat: z.coerce
        .number()
        .int('Price must be a whole number (kobo)')
        .min(100, 'Price must be at least 100 kobo (₦1)'),
    renewalDay: z.coerce
        .number()
        .int('Renewal day must be a whole number')
        .min(1, 'Renewal day must be between 1 and 28')
        .max(28, 'Renewal day must be between 1 and 28')
        .optional(),
    encryptedCredentials: z
        .string()
        .min(1, 'Encrypted credentials are required'),
});

export const updateCredentialsSchema = z.object({
    encryptedCredentials: z
        .string()
        .min(1, 'Encrypted credentials are required'),
    encryptionPassword: z
        .string()
        .optional(),
});

// ─── Memberships ───────────────────────────────────────────────────────────

export const decryptCredentialsSchema = z.object({
    encryptionPassword: z
        .string()
        .min(1, 'Encryption password is required'),
});

export const sharePasswordSchema = z.object({
    encryptionPassword: z
        .string()
        .min(1, 'Encryption password is required'),
});

export const disputeSchema = z.object({
    reason: z
        .string()
        .min(1, 'Reason is required')
        .min(5, 'Reason must be at least 5 characters')
        .max(1000, 'Reason must be at most 1000 characters'),
});

export const disputeMessageSchema = z.object({
    message: z
        .string()
        .min(1, 'Message is required')
        .min(1, 'Message cannot be empty')
        .max(2000, 'Message must be at most 2000 characters'),
});

// ─── Payments ──────────────────────────────────────────────────────────────

export const initializePaymentSchema = z.object({
    poolId: z.string().min(1, 'Pool ID is required'),
    paymentMethodId: z.string().optional(),
    useSavedCard: z.boolean().optional(),
});

export const verifyPaymentQuerySchema = z.object({
    reference: z.string().min(1, 'Reference is required'),
});

// ─── Bank ──────────────────────────────────────────────────────────────────

export const resolveBankSchema = z.object({
    bankCode: z.string().min(1, 'Bank code is required'),
    accountNumber: z
        .string()
        .min(1, 'Account number is required')
        .regex(/^\d{10}$/, 'Account number must be exactly 10 digits'),
});

export const setupBankSchema = z.object({
    bankCode: z.string().min(1, 'Bank code is required'),
    bankName: z.string().min(1, 'Bank name is required'),
    accountNumber: z
        .string()
        .min(1, 'Account number is required')
        .regex(/^\d{10}$/, 'Account number must be exactly 10 digits'),
    accountName: z
        .string()
        .min(1, 'Account name is required')
        .min(2, 'Account name must be at least 2 characters'),
});

// ─── Admin / Disputes ──────────────────────────────────────────────────────

export const adminMessageSchema = z.object({
    message: z
        .string()
        .min(1, 'Message is required')
        .max(2000, 'Message must be at most 2000 characters'),
});

export const adminNotesSchema = z.object({
    notes: z.string().max(5000, 'Notes must be at most 5000 characters').optional(),
});

export const resolveDisputeSchema = z.object({
    action: z.enum(['REFUND', 'CONFIRM_ACCESS'], {
        errorMap: () => ({ message: 'Action must be REFUND or CONFIRM_ACCESS' }),
    }),
    adminNotes: z.string().max(5000).optional(),
});