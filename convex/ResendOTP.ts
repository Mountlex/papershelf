import { Email } from "@convex-dev/auth/providers/Email";
import { Resend } from "resend";
import { alphabet, generateRandomString } from "oslo/crypto";

export const ResendOTP = Email({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return generateRandomString(6, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const fromAddress = process.env.EMAIL_FROM || "Carrel <onboarding@resend.dev>";
    console.log(`[ResendOTP] Sending verification email to ${email}, code: ${token}, from: ${fromAddress}`);

    const resend = new Resend(provider.apiKey);
    const { error, data } = await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject: `Your Carrel verification code: ${token}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #111827;">Verify your email</h2>
          <p style="color: #4b5563;">Enter this code to verify your email address:</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111827;">${token}</span>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This code expires in 15 minutes.</p>
          <p style="color: #6b7280; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error(`[ResendOTP] Failed to send email:`, error);
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
    console.log(`[ResendOTP] Email sent successfully, id: ${data?.id}`);
  },
});

export const ResendOTPPasswordReset = Email({
  id: "resend-otp-password-reset",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return generateRandomString(6, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const resend = new Resend(provider.apiKey);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Carrel <onboarding@resend.dev>",
      to: [email],
      subject: `Reset your Carrel password: ${token}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #111827;">Reset your password</h2>
          <p style="color: #4b5563;">Enter this code to reset your password:</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111827;">${token}</span>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This code expires in 15 minutes.</p>
          <p style="color: #6b7280; font-size: 14px;">If you didn't request this password reset, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Failed to send password reset email: ${error.message}`);
    }
  },
});
