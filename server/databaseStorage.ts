import { eq, desc, and, gte, lte, like, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  skuUploads,
  skuItems,
  gmailAccounts,
  supplierOrders,
  supplierOrderItems,
  emailSyncLogs,
  supplierTrackingSettings,
  supplierWhitelist,
  type User,
  type InsertUser,
  type SkuUpload,
  type InsertSkuUpload,
  type SkuItem,
  type InsertSkuItem,
  type GmailAccount,
  type InsertGmailAccount,
  type SupplierOrder,
  type InsertSupplierOrder,
  type SupplierOrderItem,
  type InsertSupplierOrderItem,
  type EmailSyncLog,
  type InsertEmailSyncLog,
  type SupplierTrackingSettings,
  type InsertSupplierTrackingSettings,
  type SupplierWhitelist,
  type InsertSupplierWhitelist,
} from "@shared/schema";
import { IStorage, SupplierOrderFilters, SupplierOrderStats } from "./storage";

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // SKU Upload methods
  async createSkuUpload(insertUpload: InsertSkuUpload): Promise<SkuUpload> {
    const [upload] = await db.insert(skuUploads).values(insertUpload).returning();
    return upload;
  }

  async getSkuUpload(id: string): Promise<SkuUpload | undefined> {
    const [upload] = await db.select().from(skuUploads).where(eq(skuUploads.id, id));
    return upload;
  }

  async getSkuUploads(limit = 50, offset = 0): Promise<SkuUpload[]> {
    return db.select().from(skuUploads)
      .orderBy(desc(skuUploads.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async updateSkuUpload(id: string, data: Partial<SkuUpload>): Promise<SkuUpload | undefined> {
    const [updated] = await db.update(skuUploads)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(skuUploads.id, id))
      .returning();
    return updated;
  }

  // SKU Item methods
  async createSkuItems(insertItems: InsertSkuItem[]): Promise<SkuItem[]> {
    if (insertItems.length === 0) return [];
    return db.insert(skuItems).values(insertItems).returning();
  }

  async getSkuItemsByUploadId(uploadId: string): Promise<SkuItem[]> {
    return db.select().from(skuItems)
      .where(eq(skuItems.uploadId, uploadId))
      .orderBy(skuItems.createdAt);
  }

  async updateSkuItem(id: string, data: Partial<SkuItem>): Promise<SkuItem | undefined> {
    const [updated] = await db.update(skuItems)
      .set(data)
      .where(eq(skuItems.id, id))
      .returning();
    return updated;
  }

  async updateSkuItemsBatch(
    uploadId: string,
    updates: { sku: string; status: string; errorMessage?: string }[]
  ): Promise<void> {
    for (const update of updates) {
      await db.update(skuItems)
        .set({ status: update.status, errorMessage: update.errorMessage })
        .where(and(eq(skuItems.uploadId, uploadId), eq(skuItems.sku, update.sku)));
    }
  }

  // Gmail Account methods
  async createGmailAccount(insertAccount: InsertGmailAccount): Promise<GmailAccount> {
    const [account] = await db.insert(gmailAccounts).values(insertAccount).returning();
    return account;
  }

  async getGmailAccount(id: string): Promise<GmailAccount | undefined> {
    const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, id));
    return account;
  }

  async getGmailAccountByEmail(email: string): Promise<GmailAccount | undefined> {
    const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.email, email));
    return account;
  }

  async getAllGmailAccounts(): Promise<GmailAccount[]> {
    return db.select().from(gmailAccounts).orderBy(desc(gmailAccounts.createdAt));
  }

  async updateGmailAccount(id: string, data: Partial<GmailAccount>): Promise<GmailAccount | undefined> {
    const [updated] = await db.update(gmailAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(gmailAccounts.id, id))
      .returning();
    return updated;
  }

  async deleteGmailAccount(id: string): Promise<boolean> {
    const result = await db.delete(gmailAccounts).where(eq(gmailAccounts.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Supplier Order methods
  async createSupplierOrder(insertOrder: InsertSupplierOrder): Promise<SupplierOrder> {
    const [order] = await db.insert(supplierOrders).values(insertOrder).returning();
    return order;
  }

  async getSupplierOrder(id: string): Promise<SupplierOrder | undefined> {
    const [order] = await db.select().from(supplierOrders).where(eq(supplierOrders.id, id));
    return order;
  }

  async getSupplierOrderByEmailId(emailMessageId: string): Promise<SupplierOrder | undefined> {
    const [order] = await db.select().from(supplierOrders)
      .where(eq(supplierOrders.emailMessageId, emailMessageId));
    return order;
  }

  async getSupplierOrderByOrderNumber(orderNumber: string): Promise<SupplierOrder | undefined> {
    const [order] = await db.select().from(supplierOrders)
      .where(eq(supplierOrders.orderNumber, orderNumber));
    return order;
  }

  async findMatchingOrder(
    supplierEmail: string | null,
    orderNumber: string | null,
    trackingNumber: string | null
  ): Promise<SupplierOrder | undefined> {
    // First priority: match by order number
    if (orderNumber) {
      const byOrderNumber = await this.getSupplierOrderByOrderNumber(orderNumber);
      if (byOrderNumber) return byOrderNumber;
    }

    // Second priority: match by tracking number
    if (trackingNumber) {
      const [byTracking] = await db.select().from(supplierOrders)
        .where(eq(supplierOrders.trackingNumber, trackingNumber));
      if (byTracking) return byTracking;
    }

    // Third priority: match by supplier email (within last 30 days, not delivered)
    if (supplierEmail) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [candidate] = await db.select().from(supplierOrders)
        .where(and(
          eq(supplierOrders.supplierEmail, supplierEmail),
          sql`${supplierOrders.status} NOT IN ('delivered', 'cancelled')`,
          gte(supplierOrders.createdAt, thirtyDaysAgo)
        ))
        .orderBy(desc(supplierOrders.createdAt))
        .limit(1);
      if (candidate) return candidate;
    }

    return undefined;
  }

  async getSupplierOrders(filters: SupplierOrderFilters): Promise<{ orders: SupplierOrder[]; total: number }> {
    const conditions = [];

    if (filters.status) {
      conditions.push(eq(supplierOrders.status, filters.status));
    }
    if (filters.startDate) {
      conditions.push(gte(supplierOrders.orderDate, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(supplierOrders.orderDate, filters.endDate));
    }
    if (filters.supplier) {
      conditions.push(like(supplierOrders.supplierName, `%${filters.supplier}%`));
    }
    if (filters.isFlagged !== undefined) {
      conditions.push(eq(supplierOrders.isFlagged, filters.isFlagged));
    }
    if (filters.gmailAccountId) {
      conditions.push(eq(supplierOrders.gmailAccountId, filters.gmailAccountId));
    }
    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(or(
        like(supplierOrders.orderNumber, searchPattern),
        like(supplierOrders.supplierName, searchPattern),
        like(supplierOrders.trackingNumber, searchPattern)
      ));
    }

    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count first
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(supplierOrders);
    const [countResult] = whereClause
      ? await countQuery.where(whereClause)
      : await countQuery;
    const total = Number(countResult?.count ?? 0);

    // Get paginated results
    const query = db.select().from(supplierOrders);
    const orders = whereClause
      ? await query
          .where(whereClause)
          .orderBy(desc(supplierOrders.orderDate), desc(supplierOrders.createdAt))
          .limit(filters.limit ?? 100)
          .offset(filters.offset ?? 0)
      : await query
          .orderBy(desc(supplierOrders.orderDate), desc(supplierOrders.createdAt))
          .limit(filters.limit ?? 100)
          .offset(filters.offset ?? 0);

    return { orders, total };
  }

  async updateSupplierOrder(id: string, data: Partial<SupplierOrder>): Promise<SupplierOrder | undefined> {
    const [updated] = await db.update(supplierOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(supplierOrders.id, id))
      .returning();
    return updated;
  }

  async getSupplierOrderStats(): Promise<SupplierOrderStats> {
    const orders = await db.select().from(supplierOrders);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);
    const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

    const activeOrders = orders.filter(
      (o) => o.status !== "delivered" && o.status !== "cancelled"
    );

    const dueToday = activeOrders.filter((o) => {
      if (!o.expectedDeliveryDate) return false;
      const dueDate = new Date(o.expectedDeliveryDate);
      return dueDate >= startOfToday && dueDate <= endOfToday;
    }).length;

    const dueThisWeek = activeOrders.filter((o) => {
      if (!o.expectedDeliveryDate) return false;
      const dueDate = new Date(o.expectedDeliveryDate);
      return dueDate >= startOfToday && dueDate <= endOfWeek;
    }).length;

    return {
      total: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      confirmed: orders.filter((o) => o.status === "confirmed").length,
      shipped: orders.filter((o) => o.status === "shipped").length,
      inTransit: orders.filter((o) => o.status === "in_transit").length,
      delivered: orders.filter((o) => o.status === "delivered").length,
      cancelled: orders.filter((o) => o.status === "cancelled").length,
      issue: orders.filter((o) => o.status === "issue").length,
      flagged: orders.filter((o) => o.isFlagged).length,
      dueToday,
      dueThisWeek,
    };
  }

  // Supplier Order Item methods
  async createSupplierOrderItems(insertItems: InsertSupplierOrderItem[]): Promise<SupplierOrderItem[]> {
    if (insertItems.length === 0) return [];
    return db.insert(supplierOrderItems).values(insertItems).returning();
  }

  async getSupplierOrderItems(orderId: string): Promise<SupplierOrderItem[]> {
    return db.select().from(supplierOrderItems)
      .where(eq(supplierOrderItems.orderId, orderId))
      .orderBy(supplierOrderItems.createdAt);
  }

  // Email Sync Log methods
  async createEmailSyncLog(insertLog: InsertEmailSyncLog): Promise<EmailSyncLog> {
    const [log] = await db.insert(emailSyncLogs).values(insertLog).returning();
    return log;
  }

  async updateEmailSyncLog(id: string, data: Partial<EmailSyncLog>): Promise<EmailSyncLog | undefined> {
    const [updated] = await db.update(emailSyncLogs)
      .set(data)
      .where(eq(emailSyncLogs.id, id))
      .returning();
    return updated;
  }

  async getRecentSyncLogs(limit = 20): Promise<EmailSyncLog[]> {
    return db.select().from(emailSyncLogs)
      .orderBy(desc(emailSyncLogs.startedAt))
      .limit(limit);
  }

  // Supplier Tracking Settings methods
  async getSupplierTrackingSettings(): Promise<SupplierTrackingSettings> {
    const [settings] = await db.select().from(supplierTrackingSettings).limit(1);

    if (settings) return settings;

    // Create default settings if none exist
    const [newSettings] = await db.insert(supplierTrackingSettings).values({
      inTransitThresholdDays: 7,
      noTrackingThresholdDays: 3,
      autoFlagOverdue: true,
      autoFlagCancelled: true,
      autoFlagNoTracking: true,
    }).returning();

    return newSettings;
  }

  async updateSupplierTrackingSettings(
    data: Partial<InsertSupplierTrackingSettings>
  ): Promise<SupplierTrackingSettings> {
    const current = await this.getSupplierTrackingSettings();

    const [updated] = await db.update(supplierTrackingSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(supplierTrackingSettings.id, current.id))
      .returning();

    return updated;
  }

  // Supplier Whitelist methods
  private extractDomainFromPattern(pattern: string): string | null {
    const atIndex = pattern.indexOf("@");
    if (atIndex === -1) return null;
    return pattern.substring(atIndex + 1).toLowerCase();
  }

  async createSupplierWhitelist(insertEntry: InsertSupplierWhitelist): Promise<SupplierWhitelist> {
    const domain = this.extractDomainFromPattern(insertEntry.emailPattern);
    const [entry] = await db.insert(supplierWhitelist).values({
      ...insertEntry,
      emailPattern: insertEntry.emailPattern.toLowerCase(),
      domain,
    }).returning();
    return entry;
  }

  async getSupplierWhitelist(id: string): Promise<SupplierWhitelist | undefined> {
    const [entry] = await db.select().from(supplierWhitelist).where(eq(supplierWhitelist.id, id));
    return entry;
  }

  async getAllSupplierWhitelist(): Promise<SupplierWhitelist[]> {
    return db.select().from(supplierWhitelist).orderBy(supplierWhitelist.name);
  }

  async getActiveSupplierWhitelist(): Promise<SupplierWhitelist[]> {
    return db.select().from(supplierWhitelist)
      .where(eq(supplierWhitelist.isActive, true))
      .orderBy(supplierWhitelist.name);
  }

  async updateSupplierWhitelist(
    id: string,
    data: Partial<InsertSupplierWhitelist>
  ): Promise<SupplierWhitelist | undefined> {
    const domain = data.emailPattern
      ? this.extractDomainFromPattern(data.emailPattern)
      : undefined;

    const updateData: Record<string, any> = {
      ...data,
      updatedAt: new Date(),
    };

    if (data.emailPattern) {
      updateData.emailPattern = data.emailPattern.toLowerCase();
      updateData.domain = domain;
    }

    const [updated] = await db.update(supplierWhitelist)
      .set(updateData)
      .where(eq(supplierWhitelist.id, id))
      .returning();
    return updated;
  }

  async deleteSupplierWhitelist(id: string): Promise<boolean> {
    const result = await db.delete(supplierWhitelist).where(eq(supplierWhitelist.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async isEmailWhitelisted(email: string): Promise<boolean> {
    const activeEntries = await this.getActiveSupplierWhitelist();

    // If no whitelist entries, allow all emails (whitelist not configured)
    if (activeEntries.length === 0) return true;

    const emailLower = email.toLowerCase();

    for (const entry of activeEntries) {
      const pattern = entry.emailPattern.toLowerCase();

      // Check for exact match
      if (emailLower === pattern) return true;

      // Check for domain match (pattern starts with @)
      if (pattern.startsWith("@") && emailLower.endsWith(pattern)) return true;

      // Check for partial match (pattern is contained in email)
      if (emailLower.includes(pattern)) return true;
    }

    return false;
  }
}
