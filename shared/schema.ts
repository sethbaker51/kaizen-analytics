import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";
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
  asin: z.string().min(1, "ASIN is required").regex(/^B[A-Z0-9]{9}$/, "Invalid ASIN format"),
  price: z.string().optional(),
  quantity: z.coerce.number().int().min(0).optional(),
  condition: z.string().transform((val) => val.toLowerCase()).pipe(z.enum(["new", "used", "refurbished"])).optional().default("new"),
  // FBA fields with defaults (case-insensitive)
  batteries_required: booleanString,
  are_batteries_included: booleanString,
  supplier_declared_dg_hz_regulation: z.string().optional().default("Not Applicable"),
});
