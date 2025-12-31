import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// SKU Upload Batch - tracks each CSV upload
export const skuUploads = pgTable("sku_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("pending"), // pending, validating, submitting, processing, completed, failed
  totalItems: integer("total_items").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  feedDocumentId: text("feed_document_id"),
  feedId: text("feed_id"),
  feedResult: text("feed_result"), // Store the full JSON result from Amazon
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSkuUploadSchema = createInsertSchema(skuUploads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSkuUpload = z.infer<typeof insertSkuUploadSchema>;
export type SkuUpload = typeof skuUploads.$inferSelect;

// Individual SKU items within an upload
export const skuItems = pgTable("sku_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadId: varchar("upload_id").notNull(),
  sku: text("sku").notNull(),
  asin: text("asin").notNull(),
  price: text("price"),
  quantity: integer("quantity"),
  condition: text("condition").default("new"),
  // FBA fields
  fulfillmentChannel: text("fulfillment_channel").default("FBA"),
  batteriesRequired: text("batteries_required").default("false"),
  areBatteriesIncluded: text("are_batteries_included").default("false"),
  supplierDeclaredDgHzRegulation: text("supplier_declared_dg_hz_regulation").default("Not Applicable"),
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, submitted, success, error
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSkuItemSchema = createInsertSchema(skuItems).omit({
  id: true,
  createdAt: true,
});

export type InsertSkuItem = z.infer<typeof insertSkuItemSchema>;
export type SkuItem = typeof skuItems.$inferSelect;

// Helper for case-insensitive boolean strings
const booleanString = z
  .string()
  .transform((val) => val.toLowerCase())
  .pipe(z.enum(["true", "false"]))
  .optional()
  .default("false");

// CSV row validation schema
export const csvSkuRowSchema = z.object({
  sku: z.string().min(1, "SKU is required"),
  asin: z.string().min(1, "ASIN is required").regex(/^(B[A-Z0-9]{9}|[0-9]{9}[0-9X])$/, "Invalid ASIN format (must be 10 chars: B followed by 9 alphanumeric, or ISBN-10)"),
  price: z.string().optional(),
  quantity: z.coerce.number().int().min(0).optional(),
  condition: z.string().transform((val) => val.toLowerCase()).pipe(z.enum(["new", "used", "refurbished"])).optional().default("new"),
  // FBA fields with defaults (case-insensitive)
  batteries_required: booleanString,
  are_batteries_included: booleanString,
  supplier_declared_dg_hz_regulation: z.string().optional().default("Not Applicable"),
});

// ============================================================================
// Supplier Tracking Tables
// ============================================================================

// Gmail Accounts - OAuth tokens for connected Gmail accounts
export const gmailAccounts = pgTable("gmail_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry").notNull(),
  lastSyncAt: timestamp("last_sync_at"),
  syncEnabled: boolean("sync_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertGmailAccountSchema = createInsertSchema(gmailAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertGmailAccount = z.infer<typeof insertGmailAccountSchema>;
export type GmailAccount = typeof gmailAccounts.$inferSelect;

// Supplier order status enum
export const supplierOrderStatusEnum = z.enum([
  "pending",
  "confirmed",
  "shipped",
  "in_transit",
  "delivered",
  "cancelled",
  "issue",
]);
export type SupplierOrderStatus = z.infer<typeof supplierOrderStatusEnum>;

// Supplier Orders - main order tracking table
export const supplierOrders = pgTable("supplier_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gmailAccountId: varchar("gmail_account_id").notNull(),
  emailMessageId: text("email_message_id").notNull().unique(),
  supplierName: text("supplier_name"),
  supplierEmail: text("supplier_email"),
  orderNumber: text("order_number"),
  orderDate: timestamp("order_date"),
  expectedDeliveryDate: timestamp("expected_delivery_date"),
  actualDeliveryDate: timestamp("actual_delivery_date"),
  status: text("status").notNull().default("pending"),
  trackingNumber: text("tracking_number"),
  carrier: text("carrier"),
  totalCost: text("total_cost"),
  currency: text("currency").default("USD"),
  notes: text("notes"),
  emailSubject: text("email_subject"),
  emailSnippet: text("email_snippet"),
  rawEmailData: text("raw_email_data"),
  isFlagged: boolean("is_flagged").default(false).notNull(),
  flagReason: text("flag_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierOrderSchema = createInsertSchema(supplierOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupplierOrder = z.infer<typeof insertSupplierOrderSchema>;
export type SupplierOrder = typeof supplierOrders.$inferSelect;

// Supplier Order Items - line items within each order
export const supplierOrderItems = pgTable("supplier_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(),
  sku: text("sku"),
  asin: text("asin"),
  productName: text("product_name"),
  quantity: integer("quantity"),
  unitCost: text("unit_cost"),
  totalCost: text("total_cost"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSupplierOrderItemSchema = createInsertSchema(supplierOrderItems).omit({
  id: true,
  createdAt: true,
});

export type InsertSupplierOrderItem = z.infer<typeof insertSupplierOrderItemSchema>;
export type SupplierOrderItem = typeof supplierOrderItems.$inferSelect;

// Email Sync Logs - tracks sync operations for debugging
export const emailSyncLogs = pgTable("email_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gmailAccountId: varchar("gmail_account_id"),
  syncType: text("sync_type").notNull(), // manual, scheduled
  status: text("status").notNull(), // running, completed, failed
  emailsProcessed: integer("emails_processed").default(0).notNull(),
  ordersCreated: integer("orders_created").default(0).notNull(),
  ordersUpdated: integer("orders_updated").default(0).notNull(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertEmailSyncLogSchema = createInsertSchema(emailSyncLogs).omit({
  id: true,
  startedAt: true,
});

export type InsertEmailSyncLog = z.infer<typeof insertEmailSyncLogSchema>;
export type EmailSyncLog = typeof emailSyncLogs.$inferSelect;

// Supplier Tracking Settings - configurable thresholds for auto-flagging
export const supplierTrackingSettings = pgTable("supplier_tracking_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inTransitThresholdDays: integer("in_transit_threshold_days").default(7).notNull(),
  noTrackingThresholdDays: integer("no_tracking_threshold_days").default(3).notNull(),
  autoFlagOverdue: boolean("auto_flag_overdue").default(true).notNull(),
  autoFlagCancelled: boolean("auto_flag_cancelled").default(true).notNull(),
  autoFlagNoTracking: boolean("auto_flag_no_tracking").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierTrackingSettingsSchema = createInsertSchema(supplierTrackingSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertSupplierTrackingSettings = z.infer<typeof insertSupplierTrackingSettingsSchema>;
export type SupplierTrackingSettings = typeof supplierTrackingSettings.$inferSelect;

// Supplier Whitelist - approved suppliers for order tracking
export const supplierWhitelist = pgTable("supplier_whitelist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  emailPattern: text("email_pattern").notNull(), // e.g., "@amazon.com" or "orders@supplier.com"
  domain: text("domain"), // e.g., "amazon.com" - extracted for quick matching
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierWhitelistSchema = createInsertSchema(supplierWhitelist).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupplierWhitelist = z.infer<typeof insertSupplierWhitelistSchema>;
export type SupplierWhitelist = typeof supplierWhitelist.$inferSelect;

// CSV upload schema for supplier whitelist
export const csvSupplierWhitelistRowSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
  email_pattern: z.string().min(1, "Email pattern is required"),
  notes: z.string().optional(),
});
