import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || '');
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@splitpayng.com';

export async function sendMagicLinkEmail(to: string, name: string, link: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: 'Your magic sign-in link',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Click the button below to sign in to your SplitPayNG account. This link expires in 15 minutes.</p>
        <a href="${link}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Sign In</a>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: 'Reset your SplitPayNG password',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>We received a request to reset your SplitPayNG password. Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Reset Password</a>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email. Your password will not be changed.</p>
      </div>
    `,
  });
}

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: 'Verify your SplitPayNG email',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Welcome to SplitPayNG! Please verify your email address by clicking the button below. This link expires in 24 hours.</p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Verify Email</a>
        <p style="color: #666; font-size: 12px;">If you didn't create an account, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendCredentialsEmail(to: string, name: string, poolName: string, password: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Your credentials for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Here are the credentials for <strong>${poolName}</strong>:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0; font-family: monospace; font-size: 14px;">
          ${password}
        </div>
        <p style="color: #666; font-size: 12px;">Do not share these credentials with anyone.</p>
      </div>
    `,
  });
}

// ─── Notification Emails ───────────────────────────────────────────────────

export async function sendEscrowReminderEmail(to: string, name: string, poolName: string, hoursLeft: number) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Escrow ending soon for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Your escrow period for <strong>${poolName}</strong> ends in approximately <strong>${hoursLeft} hours</strong>.</p>
        <p>If the credentials are working, please confirm access in your dashboard to release payment to the host. If not, you can still raise a dispute before the escrow ends.</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">View Subscriptions</a>
      </div>
    `,
  });
}

export async function sendDisputeOpenedEmail(to: string, name: string, poolName: string, reason: string, isHost: boolean) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Dispute opened on ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>A dispute has been opened on <strong>${poolName}</strong> by the ${isHost ? 'member' : 'host'}.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>An admin will review the case within 24 hours. You can add evidence and messages from your dashboard.</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">View Dashboard</a>
      </div>
    `,
  });
}

export async function sendDisputeResolvedEmail(to: string, name: string, poolName: string, resolution: string, isRefund: boolean) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Dispute resolved for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>The dispute on <strong>${poolName}</strong> has been resolved by an admin.</p>
        <p><strong>Resolution:</strong> ${isRefund ? 'You have been refunded. The pool seat is now open.' : 'Access confirmed. Host payout has been initiated.'}</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">View Dashboard</a>
      </div>
    `,
  });
}

export async function sendPayoutConfirmedEmail(to: string, name: string, poolName: string, amount: number) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Payout confirmed for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Your payout of <strong>₦${amount.toLocaleString()}</strong> for <strong>${poolName}</strong> has been confirmed and sent to your bank account.</p>
        <p>It may take 1–2 business days to reflect in your account.</p>
        <a href="${process.env.FRONTEND_URL}/host-dashboard" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">View Dashboard</a>
      </div>
    `,
  });
}

export async function sendPaymentSuccessEmail(to: string, name: string, poolName: string, amount: number) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Payment successful for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Your payment of <strong>₦${amount.toLocaleString()}</strong> for <strong>${poolName}</strong> was successful.</p>
        <p>You now have 48 hours to test the credentials. If they don't work, you can raise a dispute from your dashboard.</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">View Subscriptions</a>
      </div>
    `,
  });
}

export async function sendPoolFilledEmail(to: string, name: string, poolName: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Your pool "${poolName}" is now full`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Great news! Your pool <strong>${poolName}</strong> is now full. All seats have been taken.</p>
        <p>You can view your members and manage the pool from your host dashboard.</p>
        <a href="${process.env.FRONTEND_URL}/host-dashboard" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Host Dashboard</a>
      </div>
    `,
  });
}

export async function sendNewMemberEmail(to: string, name: string, poolName: string, memberName: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `New member joined ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p><strong>${memberName}</strong> has joined your pool <strong>${poolName}</strong>.</p>
        <p>Don't forget to share the credentials with them once payment is confirmed.</p>
        <a href="${process.env.FRONTEND_URL}/host-dashboard" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Host Dashboard</a>
      </div>
    `,
  });
}

export async function sendUpcomingBillingEmail(to: string, name: string, poolName: string, amount: number, dueDate: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Upcoming renewal for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>Your monthly subscription for <strong>${poolName}</strong> is scheduled to renew on <strong>${dueDate}</strong>.</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0; font-size: 14px; color: #374151;">Amount to be charged: <strong>₦${amount.toLocaleString()}</strong></p>
        </div>
        <p>Please ensure your linked payment card is sufficiently funded to avoid interruption of your access.</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">View Subscription</a>
      </div>
    `,
  });
}

export async function sendPaymentFailedEmail(to: string, name: string, poolName: string, amount: number) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Action Required: Payment failed for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #ef4444;">Payment Failed</h2>
        <p>Hello ${name}, we were unable to charge your card for <strong>₦${amount.toLocaleString()}</strong> for your subscription to <strong>${poolName}</strong>.</p>
        <p>To avoid losing access to your shared account credentials, please ensure your card has sufficient balance.</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #ef4444; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Update / Retry Payment</a>
      </div>
    `,
  });
}

export async function sendCredentialsRotatedEmail(to: string, name: string, poolName: string, passwordPhrase: string) {
  await resend.emails.send({
    from: `SplitPayNG <${FROM_EMAIL}>`,
    to,
    subject: `Updated credentials for ${poolName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1c2e;">Hello ${name},</h2>
        <p>The host of <strong>${poolName}</strong> has updated the account credentials.</p>
        <p>Your new encryption phrase key is:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0; font-family: monospace; font-size: 15px; font-weight: bold; color: #1f2937;">
          ${passwordPhrase}
        </div>
        <p>Visit your dashboard and click <strong>Decrypt Credentials</strong> with this phrase key to reveal the new login password.</p>
        <a href="${process.env.FRONTEND_URL}/my-subscriptions" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Go to My Subscriptions</a>
      </div>
    `,
  });
}