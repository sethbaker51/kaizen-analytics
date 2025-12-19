// Email Sync Service for Supplier Order Tracking

import { storage } from "./storage";
import * as gmail from "./gmail";
import { parseSupplierEmail, isSupplierOrderEmail } from "./emailParser";
import { log } from "./log";
import type { GmailAccount, InsertSupplierOrder, SupplierTrackingSettings } from "@shared/schema";

// Sync interval in milliseconds (default: 5 minutes)
const SYNC_INTERVAL_MS = parseInt(process.env.EMAIL_SYNC_INTERVAL_MS || "300000");

// Gmail query for supplier-related emails
const SUPPLIER_EMAIL_QUERY = [
  "subject:(order OR confirmation OR shipped OR tracking OR delivery OR invoice)",
  "newer_than:7d",
].join(" ");

// Maximum emails to process per sync
const MAX_EMAILS_PER_SYNC = 50;

let syncIntervalId: NodeJS.Timeout | null = null;

interface SyncResult {
  accountId: string;
  email: string;
  emailsProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  errors: string[];
}

/**
 * Get a valid access token for an account, refreshing if necessary
 */
async function getValidAccessToken(account: GmailAccount): Promise<string> {
  // Check if token is expired or about to expire (within 5 minutes)
  const expiryBuffer = 5 * 60 * 1000;
  const isExpired = new Date() > new Date(account.tokenExpiry.getTime() - expiryBuffer);

  if (!isExpired) {
    return account.accessToken;
  }

  log(`Refreshing token for ${account.email}`, "email-sync");

  try {
    const tokens = await gmail.refreshAccessToken(account.refreshToken);

    await storage.updateGmailAccount(account.id, {
      accessToken: tokens.accessToken,
      tokenExpiry: tokens.tokenExpiry,
    });

    return tokens.accessToken;
  } catch (error) {
    log(`Failed to refresh token for ${account.email}: ${error}`, "email-sync");
    throw error;
  }
}

/**
 * Check and apply auto-flagging rules to an order
 */
function checkAutoFlag(
  order: InsertSupplierOrder,
  settings: SupplierTrackingSettings
): {
  isFlagged: boolean;
  flagReason: string | null;
} {
  const now = new Date();

  // Flag if overdue (expected delivery passed, not delivered)
  if (
    settings.autoFlagOverdue &&
    order.expectedDeliveryDate &&
    order.status !== "delivered" &&
    order.status !== "cancelled" &&
    new Date(order.expectedDeliveryDate) < now
  ) {
    return { isFlagged: true, flagReason: "Overdue - expected delivery date passed" };
  }

  // Flag if cancelled
  if (settings.autoFlagCancelled && order.status === "cancelled") {
    return { isFlagged: true, flagReason: "Order was cancelled" };
  }

  // Flag if issue status
  if (order.status === "issue") {
    return { isFlagged: true, flagReason: "Order has reported issues" };
  }

  // Flag if no tracking after configured threshold
  if (
    settings.autoFlagNoTracking &&
    order.orderDate &&
    order.status === "confirmed" &&
    !order.trackingNumber
  ) {
    const thresholdMs = settings.noTrackingThresholdDays * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(now.getTime() - thresholdMs);
    if (new Date(order.orderDate) < thresholdDate) {
      return {
        isFlagged: true,
        flagReason: `No tracking number after ${settings.noTrackingThresholdDays} days`,
      };
    }
  }

  // Flag if in transit too long
  if (
    order.orderDate &&
    (order.status === "shipped" || order.status === "in_transit") &&
    !order.actualDeliveryDate
  ) {
    const thresholdMs = settings.inTransitThresholdDays * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(now.getTime() - thresholdMs);
    if (new Date(order.orderDate) < thresholdDate) {
      return {
        isFlagged: true,
        flagReason: `In transit for over ${settings.inTransitThresholdDays} days`,
      };
    }
  }

  return { isFlagged: false, flagReason: null };
}

/**
 * Sync emails for a single Gmail account
 */
export async function syncAccount(accountId: string): Promise<SyncResult> {
  const account = await storage.getGmailAccount(accountId);

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  if (!account.syncEnabled) {
    return {
      accountId,
      email: account.email,
      emailsProcessed: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      errors: ["Sync disabled for this account"],
    };
  }

  const result: SyncResult = {
    accountId,
    email: account.email,
    emailsProcessed: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    errors: [],
  };

  // Create sync log
  const syncLog = await storage.createEmailSyncLog({
    gmailAccountId: accountId,
    syncType: "manual",
    status: "running",
  });

  try {
    // Get valid access token
    const accessToken = await getValidAccessToken(account);

    // Get auto-flag settings
    const settings = await storage.getSupplierTrackingSettings();

    // Fetch emails
    log(`Fetching emails for ${account.email}`, "email-sync");
    const emails = await gmail.getEmailList(accessToken, SUPPLIER_EMAIL_QUERY, MAX_EMAILS_PER_SYNC);

    log(`Found ${emails.length} emails to process`, "email-sync");

    for (const emailRef of emails) {
      try {
        // Skip if we already processed this exact email
        const alreadyProcessed = await storage.getSupplierOrderByEmailId(emailRef.id);
        if (alreadyProcessed) {
          continue;
        }

        // Fetch full email content
        const emailContent = await gmail.getEmailContent(accessToken, emailRef.id);
        result.emailsProcessed++;

        // Check if this looks like a supplier order email
        if (!isSupplierOrderEmail(emailContent.subject, emailContent.body)) {
          continue;
        }

        // Parse the email
        const parsed = parseSupplierEmail(emailContent);

        // Try to find an existing order to update
        const existingOrder = await storage.findMatchingOrder(
          parsed.supplierEmail,
          parsed.orderNumber,
          parsed.trackingNumber
        );

        if (existingOrder) {
          // Update existing order with new information
          const updates: Record<string, any> = {};

          // Update tracking number if we now have one
          if (!existingOrder.trackingNumber && parsed.trackingNumber) {
            updates.trackingNumber = parsed.trackingNumber;
          }

          // Update carrier if we now have one
          if (!existingOrder.carrier && parsed.carrier) {
            updates.carrier = parsed.carrier;
          }

          // Update status if it's a progression
          const statusOrder = ["pending", "confirmed", "shipped", "in_transit", "delivered"];
          const currentStatusIndex = statusOrder.indexOf(existingOrder.status);
          const newStatusIndex = statusOrder.indexOf(parsed.status);
          if (newStatusIndex > currentStatusIndex && parsed.status !== "issue") {
            updates.status = parsed.status;
          }

          // Handle special statuses (cancelled, issue) - always update
          if (parsed.status === "cancelled" || parsed.status === "issue") {
            updates.status = parsed.status;
          }

          // Update delivery date if status is delivered
          if (parsed.status === "delivered" && !existingOrder.actualDeliveryDate) {
            updates.actualDeliveryDate = emailContent.date;
          }

          // Update expected delivery if we have a better estimate
          if (parsed.expectedDeliveryDate && !existingOrder.expectedDeliveryDate) {
            updates.expectedDeliveryDate = parsed.expectedDeliveryDate;
          }

          if (Object.keys(updates).length > 0) {
            // Re-check auto-flagging with updated data
            const updatedOrder = { ...existingOrder, ...updates } as InsertSupplierOrder;
            const { isFlagged, flagReason } = checkAutoFlag(updatedOrder, settings);
            updates.isFlagged = isFlagged;
            updates.flagReason = flagReason;

            await storage.updateSupplierOrder(existingOrder.id, updates);
            result.ordersUpdated++;
            log(`Updated order ${existingOrder.orderNumber || existingOrder.id} from email: ${emailContent.subject}`, "email-sync");
          }
        } else {
          // Create new order
          const orderData: InsertSupplierOrder = {
            gmailAccountId: accountId,
            emailMessageId: emailRef.id,
            supplierName: parsed.supplierName,
            supplierEmail: parsed.supplierEmail,
            orderNumber: parsed.orderNumber,
            orderDate: parsed.orderDate,
            expectedDeliveryDate: parsed.expectedDeliveryDate,
            status: parsed.status,
            trackingNumber: parsed.trackingNumber,
            carrier: parsed.carrier,
            totalCost: parsed.totalCost,
            currency: parsed.currency,
            emailSubject: emailContent.subject,
            emailSnippet: emailContent.snippet,
            rawEmailData: JSON.stringify({
              from: emailContent.from,
              to: emailContent.to,
              date: emailContent.date,
              body: emailContent.body.substring(0, 5000), // Limit stored body size
            }),
          };

          // Apply auto-flagging
          const { isFlagged, flagReason } = checkAutoFlag(orderData, settings);
          orderData.isFlagged = isFlagged;
          orderData.flagReason = flagReason;

          await storage.createSupplierOrder(orderData);
          result.ordersCreated++;

          log(`Created order from email: ${emailContent.subject}`, "email-sync");
        }
      } catch (emailError) {
        const errorMsg = emailError instanceof Error ? emailError.message : String(emailError);
        result.errors.push(`Email ${emailRef.id}: ${errorMsg}`);
        log(`Error processing email ${emailRef.id}: ${errorMsg}`, "email-sync");
      }
    }

    // Update last sync time
    await storage.updateGmailAccount(accountId, { lastSyncAt: new Date() });

    // Update sync log
    await storage.updateEmailSyncLog(syncLog.id, {
      status: "completed",
      emailsProcessed: result.emailsProcessed,
      ordersCreated: result.ordersCreated,
      ordersUpdated: result.ordersUpdated,
      completedAt: new Date(),
    });

    log(
      `Sync completed for ${account.email}: ${result.emailsProcessed} emails, ${result.ordersCreated} orders created`,
      "email-sync"
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);

    await storage.updateEmailSyncLog(syncLog.id, {
      status: "failed",
      errorMessage: errorMsg,
      completedAt: new Date(),
    });

    log(`Sync failed for ${account.email}: ${errorMsg}`, "email-sync");
  }

  return result;
}

/**
 * Sync all enabled Gmail accounts
 */
export async function syncAllAccounts(): Promise<SyncResult[]> {
  const accounts = await storage.getAllGmailAccounts();
  const enabledAccounts = accounts.filter((a) => a.syncEnabled);

  log(`Starting sync for ${enabledAccounts.length} accounts`, "email-sync");

  const results: SyncResult[] = [];

  for (const account of enabledAccounts) {
    try {
      const result = await syncAccount(account.id);
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        accountId: account.id,
        email: account.email,
        emailsProcessed: 0,
        ordersCreated: 0,
        ordersUpdated: 0,
        errors: [errorMsg],
      });
    }

    // Small delay between accounts to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
}

/**
 * Start the background polling scheduler
 */
export function startPollingScheduler(): void {
  if (syncIntervalId) {
    log("Polling scheduler already running", "email-sync");
    return;
  }

  log(`Starting email sync scheduler (interval: ${SYNC_INTERVAL_MS}ms)`, "email-sync");

  // Run initial sync after a short delay
  setTimeout(async () => {
    try {
      await syncAllAccounts();
    } catch (error) {
      log(`Initial sync failed: ${error}`, "email-sync");
    }
  }, 10000); // 10 second delay for initial sync

  // Schedule recurring syncs
  syncIntervalId = setInterval(async () => {
    try {
      await syncAllAccounts();
    } catch (error) {
      log(`Scheduled sync failed: ${error}`, "email-sync");
    }
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop the background polling scheduler
 */
export function stopPollingScheduler(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    log("Email sync scheduler stopped", "email-sync");
  }
}

/**
 * Check if the scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return syncIntervalId !== null;
}
