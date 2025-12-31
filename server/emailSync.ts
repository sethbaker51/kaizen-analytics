// Email Sync Service for Supplier Order Tracking

import { storage } from "./storage";
import * as gmail from "./gmail";
import { parseSupplierEmail, isSupplierOrderEmail, isCourierDomain, extractDomainFromEmail, COURIER_DOMAINS, extractTrackingNumber, detectEmailType, extractSupplierEmail } from "./emailParser";
import { log } from "./log";
import type { GmailAccount, InsertSupplierOrder, SupplierTrackingSettings, SupplierWhitelist } from "@shared/schema";

// Sync interval in milliseconds (default: 15 minutes for deep per-supplier sync)
const SYNC_INTERVAL_MS = parseInt(process.env.EMAIL_SYNC_INTERVAL_MS || "900000");

// Maximum emails to fetch per supplier (each supplier gets this many)
const MAX_EMAILS_PER_SUPPLIER = 100;

// Days to look back for emails
const SYNC_DAYS_BACK = 30;

// Early termination: if this % of emails are already processed, skip rest
const SKIP_THRESHOLD_PERCENT = 80;

// Maximum new emails to process per supplier (prevents runaway on first sync)
const MAX_NEW_EMAILS_PER_SUPPLIER = 50;

// Delay between suppliers in ms (rate limiting)
const SUPPLIER_DELAY_MS = 300;

let syncIntervalId: NodeJS.Timeout | null = null;

interface SupplierSyncResult {
  supplierName: string;
  supplierDomain: string;
  emailsFound: number;
  emailsProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  error?: string;
}

interface SyncResult {
  accountId: string;
  email: string;
  emailsProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  errors: string[];
  supplierResults: SupplierSyncResult[];
  suppliersScanned: number;
  totalSuppliers: number;
}

// Track active sync progress for status reporting
interface SyncProgress {
  isRunning: boolean;
  currentSupplier: string | null;
  suppliersScanned: number;
  totalSuppliers: number;
  startedAt: Date | null;
}

let currentSyncProgress: SyncProgress = {
  isRunning: false,
  currentSupplier: null,
  suppliersScanned: 0,
  totalSuppliers: 0,
  startedAt: null,
};

export function getSyncProgress(): SyncProgress {
  return { ...currentSyncProgress };
}

// Courier sync configuration
const MAX_COURIER_EMAILS = 100; // Max courier emails to scan per sync
const COURIER_SYNC_ENABLED = true; // Enable/disable courier email processing

interface CourierSyncResult {
  courierName: string;
  emailsScanned: number;
  ordersUpdated: number;
  trackingMatches: number;
}

/**
 * Process courier emails to update existing orders with delivery status
 * Scans emails from courier domains (Royal Mail, DPD, FedEx, etc.)
 * and matches tracking numbers to existing supplier orders
 */
async function processCourierEmails(
  account: GmailAccount,
  accessToken: string,
  settings: SupplierTrackingSettings
): Promise<CourierSyncResult[]> {
  const results: CourierSyncResult[] = [];

  if (!COURIER_SYNC_ENABLED) {
    return results;
  }

  log("Starting courier email scan for order updates", "email-sync");

  // Build list of courier domains to scan
  const courierDomains = Array.from(COURIER_DOMAINS).slice(0, 20); // Limit to top 20 couriers

  for (const domain of courierDomains) {
    const result: CourierSyncResult = {
      courierName: domain,
      emailsScanned: 0,
      ordersUpdated: 0,
      trackingMatches: 0,
    };

    try {
      // Query for emails from this courier
      const courierQuery = `from:@${domain} newer_than:${SYNC_DAYS_BACK}d`;
      const emails = await gmail.getEmailList(accessToken, courierQuery, 50);

      if (emails.length === 0) {
        continue;
      }

      result.emailsScanned = emails.length;

      // Process each courier email
      for (const emailRef of emails) {
        try {
          // Fetch email content
          const emailContent = await gmail.getEmailContent(accessToken, emailRef.id);

          // Extract tracking number from courier email
          const { tracking: trackingNumber, carrier } = extractTrackingNumber(emailContent.body);

          if (!trackingNumber) {
            continue;
          }

          // Find orders with this tracking number
          const matchingOrders = await storage.getOrdersByTrackingNumber(trackingNumber);

          if (matchingOrders.length === 0) {
            continue;
          }

          result.trackingMatches++;

          // Detect status from courier email
          const newStatus = detectEmailType(emailContent.subject, emailContent.body);

          // Update each matching order
          for (const order of matchingOrders) {
            const updates: Record<string, any> = {};

            // Update status if it's a progression
            const statusOrder = ["pending", "confirmed", "shipped", "in_transit", "delivered"];
            const currentStatusIndex = statusOrder.indexOf(order.status);
            const newStatusIndex = statusOrder.indexOf(newStatus);

            if (newStatusIndex > currentStatusIndex) {
              updates.status = newStatus;
            }

            // Update carrier if we detected one and order doesn't have one
            if (carrier && !order.carrier) {
              updates.carrier = carrier;
            }

            // If delivered, set actual delivery date
            if (newStatus === "delivered" && !order.actualDeliveryDate) {
              updates.actualDeliveryDate = emailContent.date;
            }

            // Only update if we have changes
            if (Object.keys(updates).length > 0) {
              // Re-check auto-flagging
              const updatedOrder = { ...order, ...updates } as InsertSupplierOrder;
              const { isFlagged, flagReason } = checkAutoFlag(updatedOrder, settings);
              updates.isFlagged = isFlagged;
              updates.flagReason = flagReason;

              await storage.updateSupplierOrder(order.id, updates);
              result.ordersUpdated++;

              log(
                `Courier update: ${domain} -> Order ${order.orderNumber || order.id} now ${newStatus}`,
                "email-sync"
              );
            }
          }
        } catch (emailError) {
          // Skip individual email errors
        }
      }

      if (result.ordersUpdated > 0) {
        results.push(result);
        log(`${domain}: ${result.trackingMatches} tracking matches, ${result.ordersUpdated} orders updated`, "email-sync");
      }
    } catch (error) {
      // Skip courier domain errors
    }

    // Small delay between courier domains
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const totalUpdates = results.reduce((sum, r) => sum + r.ordersUpdated, 0);
  if (totalUpdates > 0) {
    log(`Courier scan complete: ${totalUpdates} orders updated from courier emails`, "email-sync");
  }

  return results;
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
 * Process emails for a single supplier - optimized for large supplier lists
 */
async function syncSupplier(
  account: GmailAccount,
  accessToken: string,
  supplier: SupplierWhitelist,
  settings: SupplierTrackingSettings
): Promise<SupplierSyncResult> {
  const result: SupplierSyncResult = {
    supplierName: supplier.name,
    supplierDomain: supplier.domain || "",
    emailsFound: 0,
    emailsProcessed: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
  };

  // Skip courier domains - they are NOT suppliers
  // Courier emails (Royal Mail, DPD, etc.) should not create orders
  if (supplier.domain && isCourierDomain(`test@${supplier.domain}`)) {
    result.error = "Skipped: courier/carrier domain, not a supplier";
    log(`Skipping ${supplier.name}: courier domain, not a supplier`, "email-sync");
    return result;
  }

  try {
    // Build query for this specific supplier's domain
    const supplierQuery = [
      `from:${supplier.emailPattern}`,
      `newer_than:${SYNC_DAYS_BACK}d`,
    ].join(" ");

    log(`Scanning supplier: ${supplier.name} (${supplier.emailPattern})`, "email-sync");

    // Step 1: Fetch email list (just IDs - very fast)
    const emails = await gmail.getEmailList(accessToken, supplierQuery, MAX_EMAILS_PER_SUPPLIER);
    result.emailsFound = emails.length;

    if (emails.length === 0) {
      return result;
    }

    // Step 2: Batch check which emails are already processed (single DB query)
    const emailIds = emails.map((e) => e.id);
    const processedIds = await storage.getProcessedEmailIds(emailIds);
    const processedSet = new Set(processedIds);

    // Filter to only unprocessed emails
    const unprocessedEmails = emails.filter((e) => !processedSet.has(e.id));
    const alreadyProcessedCount = emails.length - unprocessedEmails.length;

    // Early termination: if most emails already processed, skip this supplier
    const processedPercent = (alreadyProcessedCount / emails.length) * 100;
    if (processedPercent >= SKIP_THRESHOLD_PERCENT && unprocessedEmails.length === 0) {
      log(`${supplier.name}: ${alreadyProcessedCount}/${emails.length} already processed, skipping`, "email-sync");
      return result;
    }

    // Limit new emails to process per supplier
    const emailsToProcess = unprocessedEmails.slice(0, MAX_NEW_EMAILS_PER_SUPPLIER);

    if (emailsToProcess.length === 0) {
      log(`${supplier.name}: no new emails to process`, "email-sync");
      return result;
    }

    log(`${supplier.name}: processing ${emailsToProcess.length} new emails (${alreadyProcessedCount} already done)`, "email-sync");

    // Step 3: Process unprocessed emails
    for (const emailRef of emailsToProcess) {
      try {
        // Fetch full email content
        const emailContent = await gmail.getEmailContent(accessToken, emailRef.id);
        result.emailsProcessed++;

        // Check if this looks like a supplier order email
        if (!isSupplierOrderEmail(emailContent.subject, emailContent.body)) {
          continue;
        }

        // Parse the email
        const parsed = parseSupplierEmail(emailContent);

        // Override supplier info with whitelist data for consistency
        if (!parsed.supplierName || parsed.supplierName === "Unknown") {
          parsed.supplierName = supplier.name;
        }

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
          }
        } else {
          // Create new order
          const orderData: InsertSupplierOrder = {
            gmailAccountId: account.id,
            emailMessageId: emailRef.id,
            supplierName: parsed.supplierName || supplier.name,
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
              body: emailContent.body.substring(0, 5000),
            }),
          };

          // Apply auto-flagging
          const { isFlagged, flagReason } = checkAutoFlag(orderData, settings);
          orderData.isFlagged = isFlagged;
          orderData.flagReason = flagReason;

          await storage.createSupplierOrder(orderData);
          result.ordersCreated++;
        }
      } catch (emailError) {
        const errorMsg = emailError instanceof Error ? emailError.message : String(emailError);
        log(`Error processing email from ${supplier.name}: ${errorMsg}`, "email-sync");
      }
    }

    if (result.ordersCreated > 0 || result.ordersUpdated > 0) {
      log(`${supplier.name}: +${result.ordersCreated} created, ${result.ordersUpdated} updated`, "email-sync");
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    log(`Error scanning ${supplier.name}: ${result.error}`, "email-sync");
  }

  return result;
}

/**
 * Sync emails for a single Gmail account - systematically scans each whitelisted supplier
 */
export async function syncAccount(accountId: string): Promise<SyncResult> {
  const account = await storage.getGmailAccount(accountId);

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  // Get all active whitelisted suppliers
  const allSuppliers = await storage.getAllSupplierWhitelist();
  const activeSuppliers = allSuppliers.filter((s) => s.isActive);

  if (!account.syncEnabled) {
    return {
      accountId,
      email: account.email,
      emailsProcessed: 0,
      ordersCreated: 0,
      ordersUpdated: 0,
      errors: ["Sync disabled for this account"],
      supplierResults: [],
      suppliersScanned: 0,
      totalSuppliers: activeSuppliers.length,
    };
  }

  const result: SyncResult = {
    accountId,
    email: account.email,
    emailsProcessed: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    errors: [],
    supplierResults: [],
    suppliersScanned: 0,
    totalSuppliers: activeSuppliers.length,
  };

  if (activeSuppliers.length === 0) {
    result.errors.push("No active suppliers in whitelist. Add suppliers to start tracking orders.");
    return result;
  }

  // Create sync log
  const syncLog = await storage.createEmailSyncLog({
    gmailAccountId: accountId,
    syncType: "manual",
    status: "running",
  });

  // Update global progress
  currentSyncProgress = {
    isRunning: true,
    currentSupplier: null,
    suppliersScanned: 0,
    totalSuppliers: activeSuppliers.length,
    startedAt: new Date(),
  };

  try {
    // Get valid access token
    const accessToken = await getValidAccessToken(account);

    // Get auto-flag settings
    const settings = await storage.getSupplierTrackingSettings();

    log(`Starting per-supplier sync for ${account.email} (${activeSuppliers.length} suppliers)`, "email-sync");

    // Process each supplier systematically
    for (let i = 0; i < activeSuppliers.length; i++) {
      const supplier = activeSuppliers[i];

      // Update progress
      currentSyncProgress.currentSupplier = supplier.name;
      currentSyncProgress.suppliersScanned = i;

      // Sync this supplier
      const supplierResult = await syncSupplier(account, accessToken, supplier, settings);
      result.supplierResults.push(supplierResult);

      // Aggregate totals
      result.emailsProcessed += supplierResult.emailsProcessed;
      result.ordersCreated += supplierResult.ordersCreated;
      result.ordersUpdated += supplierResult.ordersUpdated;
      if (supplierResult.error) {
        result.errors.push(`${supplier.name}: ${supplierResult.error}`);
      }

      result.suppliersScanned = i + 1;

      // Small delay between suppliers to avoid rate limits
      if (i < activeSuppliers.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, SUPPLIER_DELAY_MS));
      }
    }

    // Process courier emails to update existing orders with delivery status
    currentSyncProgress.currentSupplier = "Scanning courier emails...";
    const courierResults = await processCourierEmails(account, accessToken, settings);
    const courierUpdates = courierResults.reduce((sum, r) => sum + r.ordersUpdated, 0);
    result.ordersUpdated += courierUpdates;

    // Update last sync time
    await storage.updateGmailAccount(accountId, { lastSyncAt: new Date() });

    // Build detailed log message
    const supplierSummary = result.supplierResults
      .filter((s) => s.ordersCreated > 0 || s.ordersUpdated > 0)
      .map((s) => `${s.supplierName}: +${s.ordersCreated}/${s.ordersUpdated}u`)
      .join(", ");

    const courierSummary = courierUpdates > 0 ? ` | Courier updates: ${courierUpdates}` : "";

    // Update sync log with per-supplier details
    await storage.updateEmailSyncLog(syncLog.id, {
      status: "completed",
      emailsProcessed: result.emailsProcessed,
      ordersCreated: result.ordersCreated,
      ordersUpdated: result.ordersUpdated,
      completedAt: new Date(),
      errorMessage: (supplierSummary + courierSummary) || undefined,
    });

    log(
      `Sync completed for ${account.email}: ${result.suppliersScanned} suppliers, ${result.emailsProcessed} emails, ${result.ordersCreated} orders created, ${result.ordersUpdated} updated${courierSummary}`,
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
  } finally {
    // Clear progress
    currentSyncProgress = {
      isRunning: false,
      currentSupplier: null,
      suppliersScanned: result.suppliersScanned,
      totalSuppliers: result.totalSuppliers,
      startedAt: null,
    };
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
        supplierResults: [],
        suppliersScanned: 0,
        totalSuppliers: 0,
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
