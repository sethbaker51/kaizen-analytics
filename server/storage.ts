import {
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
} from "@shared/schema";
import { randomUUID } from "crypto";

// Filter options for supplier orders
export interface SupplierOrderFilters {
  status?: string;
  startDate?: Date;
  endDate?: Date;
  supplier?: string;
  isFlagged?: boolean;
  search?: string;
  gmailAccountId?: string;
  limit?: number;
  offset?: number;
}

// Stats for supplier orders dashboard
export interface SupplierOrderStats {
  total: number;
  pending: number;
  confirmed: number;
  shipped: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  issue: number;
  flagged: number;
  dueToday: number;
  dueThisWeek: number;
}

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // SKU Upload methods
  createSkuUpload(upload: InsertSkuUpload): Promise<SkuUpload>;
  getSkuUpload(id: string): Promise<SkuUpload | undefined>;
  getSkuUploads(limit?: number, offset?: number): Promise<SkuUpload[]>;
  updateSkuUpload(id: string, data: Partial<SkuUpload>): Promise<SkuUpload | undefined>;

  // SKU Item methods
  createSkuItems(items: InsertSkuItem[]): Promise<SkuItem[]>;
  getSkuItemsByUploadId(uploadId: string): Promise<SkuItem[]>;
  updateSkuItem(id: string, data: Partial<SkuItem>): Promise<SkuItem | undefined>;
  updateSkuItemsBatch(uploadId: string, updates: { sku: string; status: string; errorMessage?: string }[]): Promise<void>;

  // Gmail Account methods
  createGmailAccount(account: InsertGmailAccount): Promise<GmailAccount>;
  getGmailAccount(id: string): Promise<GmailAccount | undefined>;
  getGmailAccountByEmail(email: string): Promise<GmailAccount | undefined>;
  getAllGmailAccounts(): Promise<GmailAccount[]>;
  updateGmailAccount(id: string, data: Partial<GmailAccount>): Promise<GmailAccount | undefined>;
  deleteGmailAccount(id: string): Promise<boolean>;

  // Supplier Order methods
  createSupplierOrder(order: InsertSupplierOrder): Promise<SupplierOrder>;
  getSupplierOrder(id: string): Promise<SupplierOrder | undefined>;
  getSupplierOrderByEmailId(emailMessageId: string): Promise<SupplierOrder | undefined>;
  getSupplierOrderByOrderNumber(orderNumber: string): Promise<SupplierOrder | undefined>;
  findMatchingOrder(supplierEmail: string | null, orderNumber: string | null, trackingNumber: string | null): Promise<SupplierOrder | undefined>;
  getSupplierOrders(filters: SupplierOrderFilters): Promise<{ orders: SupplierOrder[]; total: number }>;
  updateSupplierOrder(id: string, data: Partial<SupplierOrder>): Promise<SupplierOrder | undefined>;
  getSupplierOrderStats(): Promise<SupplierOrderStats>;

  // Supplier Order Item methods
  createSupplierOrderItems(items: InsertSupplierOrderItem[]): Promise<SupplierOrderItem[]>;
  getSupplierOrderItems(orderId: string): Promise<SupplierOrderItem[]>;

  // Email Sync Log methods
  createEmailSyncLog(log: InsertEmailSyncLog): Promise<EmailSyncLog>;
  updateEmailSyncLog(id: string, data: Partial<EmailSyncLog>): Promise<EmailSyncLog | undefined>;
  getRecentSyncLogs(limit?: number): Promise<EmailSyncLog[]>;

  // Supplier Tracking Settings methods
  getSupplierTrackingSettings(): Promise<SupplierTrackingSettings>;
  updateSupplierTrackingSettings(data: Partial<InsertSupplierTrackingSettings>): Promise<SupplierTrackingSettings>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private skuUploads: Map<string, SkuUpload>;
  private skuItems: Map<string, SkuItem>;
  private gmailAccounts: Map<string, GmailAccount>;
  private supplierOrders: Map<string, SupplierOrder>;
  private supplierOrderItems: Map<string, SupplierOrderItem>;
  private emailSyncLogs: Map<string, EmailSyncLog>;
  private supplierTrackingSettings: SupplierTrackingSettings | null;

  constructor() {
    this.users = new Map();
    this.skuUploads = new Map();
    this.skuItems = new Map();
    this.gmailAccounts = new Map();
    this.supplierOrders = new Map();
    this.supplierOrderItems = new Map();
    this.emailSyncLogs = new Map();
    this.supplierTrackingSettings = null;
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // SKU Upload methods
  async createSkuUpload(insertUpload: InsertSkuUpload): Promise<SkuUpload> {
    const id = randomUUID();
    const now = new Date();
    const upload: SkuUpload = {
      id,
      filename: insertUpload.filename,
      status: insertUpload.status ?? "pending",
      totalItems: insertUpload.totalItems ?? 0,
      successCount: insertUpload.successCount ?? 0,
      errorCount: insertUpload.errorCount ?? 0,
      feedDocumentId: insertUpload.feedDocumentId ?? null,
      feedId: insertUpload.feedId ?? null,
      feedResult: insertUpload.feedResult ?? null,
      errorMessage: insertUpload.errorMessage ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.skuUploads.set(id, upload);
    return upload;
  }

  async getSkuUpload(id: string): Promise<SkuUpload | undefined> {
    return this.skuUploads.get(id);
  }

  async getSkuUploads(limit = 50, offset = 0): Promise<SkuUpload[]> {
    const uploads = Array.from(this.skuUploads.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return uploads.slice(offset, offset + limit);
  }

  async updateSkuUpload(id: string, data: Partial<SkuUpload>): Promise<SkuUpload | undefined> {
    const upload = this.skuUploads.get(id);
    if (!upload) return undefined;

    const updated: SkuUpload = {
      ...upload,
      ...data,
      id, // Ensure id cannot be changed
      updatedAt: new Date(),
    };
    this.skuUploads.set(id, updated);
    return updated;
  }

  // SKU Item methods
  async createSkuItems(insertItems: InsertSkuItem[]): Promise<SkuItem[]> {
    const items: SkuItem[] = [];
    const now = new Date();

    for (const insertItem of insertItems) {
      const id = randomUUID();
      const item: SkuItem = {
        id,
        uploadId: insertItem.uploadId,
        sku: insertItem.sku,
        asin: insertItem.asin,
        price: insertItem.price ?? null,
        quantity: insertItem.quantity ?? null,
        condition: insertItem.condition ?? "new",
        // FBA fields
        fulfillmentChannel: insertItem.fulfillmentChannel ?? "FBA",
        batteriesRequired: insertItem.batteriesRequired ?? "false",
        areBatteriesIncluded: insertItem.areBatteriesIncluded ?? "false",
        supplierDeclaredDgHzRegulation: insertItem.supplierDeclaredDgHzRegulation ?? "Not Applicable",
        // Status
        status: insertItem.status ?? "pending",
        errorMessage: insertItem.errorMessage ?? null,
        createdAt: now,
      };
      this.skuItems.set(id, item);
      items.push(item);
    }

    return items;
  }

  async getSkuItemsByUploadId(uploadId: string): Promise<SkuItem[]> {
    return Array.from(this.skuItems.values())
      .filter((item) => item.uploadId === uploadId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async updateSkuItem(id: string, data: Partial<SkuItem>): Promise<SkuItem | undefined> {
    const item = this.skuItems.get(id);
    if (!item) return undefined;

    const updated: SkuItem = {
      ...item,
      ...data,
      id, // Ensure id cannot be changed
    };
    this.skuItems.set(id, updated);
    return updated;
  }

  async updateSkuItemsBatch(
    uploadId: string,
    updates: { sku: string; status: string; errorMessage?: string }[]
  ): Promise<void> {
    const updateMap = new Map(updates.map((u) => [u.sku, u]));

    Array.from(this.skuItems.entries()).forEach(([id, item]) => {
      if (item.uploadId === uploadId && updateMap.has(item.sku)) {
        const update = updateMap.get(item.sku)!;
        this.skuItems.set(id, {
          ...item,
          status: update.status,
          errorMessage: update.errorMessage ?? item.errorMessage,
        });
      }
    });
  }

  // Gmail Account methods
  async createGmailAccount(insertAccount: InsertGmailAccount): Promise<GmailAccount> {
    const id = randomUUID();
    const now = new Date();
    const account: GmailAccount = {
      id,
      email: insertAccount.email,
      accessToken: insertAccount.accessToken,
      refreshToken: insertAccount.refreshToken,
      tokenExpiry: insertAccount.tokenExpiry,
      lastSyncAt: insertAccount.lastSyncAt ?? null,
      syncEnabled: insertAccount.syncEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.gmailAccounts.set(id, account);
    return account;
  }

  async getGmailAccount(id: string): Promise<GmailAccount | undefined> {
    return this.gmailAccounts.get(id);
  }

  async getGmailAccountByEmail(email: string): Promise<GmailAccount | undefined> {
    return Array.from(this.gmailAccounts.values()).find(
      (account) => account.email === email
    );
  }

  async getAllGmailAccounts(): Promise<GmailAccount[]> {
    return Array.from(this.gmailAccounts.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateGmailAccount(id: string, data: Partial<GmailAccount>): Promise<GmailAccount | undefined> {
    const account = this.gmailAccounts.get(id);
    if (!account) return undefined;

    const updated: GmailAccount = {
      ...account,
      ...data,
      id,
      updatedAt: new Date(),
    };
    this.gmailAccounts.set(id, updated);
    return updated;
  }

  async deleteGmailAccount(id: string): Promise<boolean> {
    return this.gmailAccounts.delete(id);
  }

  // Supplier Order methods
  async createSupplierOrder(insertOrder: InsertSupplierOrder): Promise<SupplierOrder> {
    const id = randomUUID();
    const now = new Date();
    const order: SupplierOrder = {
      id,
      gmailAccountId: insertOrder.gmailAccountId,
      emailMessageId: insertOrder.emailMessageId,
      supplierName: insertOrder.supplierName ?? null,
      supplierEmail: insertOrder.supplierEmail ?? null,
      orderNumber: insertOrder.orderNumber ?? null,
      orderDate: insertOrder.orderDate ?? null,
      expectedDeliveryDate: insertOrder.expectedDeliveryDate ?? null,
      actualDeliveryDate: insertOrder.actualDeliveryDate ?? null,
      status: insertOrder.status ?? "pending",
      trackingNumber: insertOrder.trackingNumber ?? null,
      carrier: insertOrder.carrier ?? null,
      totalCost: insertOrder.totalCost ?? null,
      currency: insertOrder.currency ?? "USD",
      notes: insertOrder.notes ?? null,
      emailSubject: insertOrder.emailSubject ?? null,
      emailSnippet: insertOrder.emailSnippet ?? null,
      rawEmailData: insertOrder.rawEmailData ?? null,
      isFlagged: insertOrder.isFlagged ?? false,
      flagReason: insertOrder.flagReason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.supplierOrders.set(id, order);
    return order;
  }

  async getSupplierOrder(id: string): Promise<SupplierOrder | undefined> {
    return this.supplierOrders.get(id);
  }

  async getSupplierOrderByEmailId(emailMessageId: string): Promise<SupplierOrder | undefined> {
    return Array.from(this.supplierOrders.values()).find(
      (order) => order.emailMessageId === emailMessageId
    );
  }

  async getSupplierOrderByOrderNumber(orderNumber: string): Promise<SupplierOrder | undefined> {
    return Array.from(this.supplierOrders.values()).find(
      (order) => order.orderNumber === orderNumber
    );
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
      const byTracking = Array.from(this.supplierOrders.values()).find(
        (order) => order.trackingNumber === trackingNumber
      );
      if (byTracking) return byTracking;
    }

    // Third priority: match by supplier email (within last 30 days, not delivered)
    if (supplierEmail) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const candidates = Array.from(this.supplierOrders.values())
        .filter(
          (order) =>
            order.supplierEmail === supplierEmail &&
            order.status !== "delivered" &&
            order.status !== "cancelled" &&
            order.createdAt >= thirtyDaysAgo
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Return the most recent matching order
      if (candidates.length > 0) return candidates[0];
    }

    return undefined;
  }

  async getSupplierOrders(filters: SupplierOrderFilters): Promise<{ orders: SupplierOrder[]; total: number }> {
    let orders = Array.from(this.supplierOrders.values());

    // Apply filters
    if (filters.status) {
      orders = orders.filter((o) => o.status === filters.status);
    }
    if (filters.startDate) {
      orders = orders.filter((o) => o.orderDate && o.orderDate >= filters.startDate!);
    }
    if (filters.endDate) {
      orders = orders.filter((o) => o.orderDate && o.orderDate <= filters.endDate!);
    }
    if (filters.supplier) {
      const supplierLower = filters.supplier.toLowerCase();
      orders = orders.filter((o) =>
        o.supplierName?.toLowerCase().includes(supplierLower)
      );
    }
    if (filters.isFlagged !== undefined) {
      orders = orders.filter((o) => o.isFlagged === filters.isFlagged);
    }
    if (filters.gmailAccountId) {
      orders = orders.filter((o) => o.gmailAccountId === filters.gmailAccountId);
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      orders = orders.filter((o) =>
        o.orderNumber?.toLowerCase().includes(searchLower) ||
        o.supplierName?.toLowerCase().includes(searchLower) ||
        o.trackingNumber?.toLowerCase().includes(searchLower)
      );
    }

    // Sort by order date descending, then created date
    orders.sort((a, b) => {
      const dateA = a.orderDate?.getTime() ?? a.createdAt.getTime();
      const dateB = b.orderDate?.getTime() ?? b.createdAt.getTime();
      return dateB - dateA;
    });

    // Get total before pagination
    const total = orders.length;

    // Apply pagination
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 100;
    const paginatedOrders = orders.slice(offset, offset + limit);

    return { orders: paginatedOrders, total };
  }

  async updateSupplierOrder(id: string, data: Partial<SupplierOrder>): Promise<SupplierOrder | undefined> {
    const order = this.supplierOrders.get(id);
    if (!order) return undefined;

    const updated: SupplierOrder = {
      ...order,
      ...data,
      id,
      updatedAt: new Date(),
    };
    this.supplierOrders.set(id, updated);
    return updated;
  }

  async getSupplierOrderStats(): Promise<SupplierOrderStats> {
    const orders = Array.from(this.supplierOrders.values());

    // Calculate due today/this week for non-delivered, non-cancelled orders
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
    const items: SupplierOrderItem[] = [];
    const now = new Date();

    for (const insertItem of insertItems) {
      const id = randomUUID();
      const item: SupplierOrderItem = {
        id,
        orderId: insertItem.orderId,
        sku: insertItem.sku ?? null,
        asin: insertItem.asin ?? null,
        productName: insertItem.productName ?? null,
        quantity: insertItem.quantity ?? null,
        unitCost: insertItem.unitCost ?? null,
        totalCost: insertItem.totalCost ?? null,
        createdAt: now,
      };
      this.supplierOrderItems.set(id, item);
      items.push(item);
    }

    return items;
  }

  async getSupplierOrderItems(orderId: string): Promise<SupplierOrderItem[]> {
    return Array.from(this.supplierOrderItems.values())
      .filter((item) => item.orderId === orderId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // Email Sync Log methods
  async createEmailSyncLog(insertLog: InsertEmailSyncLog): Promise<EmailSyncLog> {
    const id = randomUUID();
    const now = new Date();
    const log: EmailSyncLog = {
      id,
      gmailAccountId: insertLog.gmailAccountId ?? null,
      syncType: insertLog.syncType,
      status: insertLog.status,
      emailsProcessed: insertLog.emailsProcessed ?? 0,
      ordersCreated: insertLog.ordersCreated ?? 0,
      ordersUpdated: insertLog.ordersUpdated ?? 0,
      errorMessage: insertLog.errorMessage ?? null,
      startedAt: now,
      completedAt: insertLog.completedAt ?? null,
    };
    this.emailSyncLogs.set(id, log);
    return log;
  }

  async updateEmailSyncLog(id: string, data: Partial<EmailSyncLog>): Promise<EmailSyncLog | undefined> {
    const log = this.emailSyncLogs.get(id);
    if (!log) return undefined;

    const updated: EmailSyncLog = {
      ...log,
      ...data,
      id,
    };
    this.emailSyncLogs.set(id, updated);
    return updated;
  }

  async getRecentSyncLogs(limit = 20): Promise<EmailSyncLog[]> {
    return Array.from(this.emailSyncLogs.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  // Supplier Tracking Settings methods
  async getSupplierTrackingSettings(): Promise<SupplierTrackingSettings> {
    // Return existing settings or create default
    if (!this.supplierTrackingSettings) {
      this.supplierTrackingSettings = {
        id: randomUUID(),
        inTransitThresholdDays: 7,
        noTrackingThresholdDays: 3,
        autoFlagOverdue: true,
        autoFlagCancelled: true,
        autoFlagNoTracking: true,
        updatedAt: new Date(),
      };
    }
    return this.supplierTrackingSettings;
  }

  async updateSupplierTrackingSettings(
    data: Partial<InsertSupplierTrackingSettings>
  ): Promise<SupplierTrackingSettings> {
    const current = await this.getSupplierTrackingSettings();
    this.supplierTrackingSettings = {
      ...current,
      ...data,
      updatedAt: new Date(),
    };
    return this.supplierTrackingSettings;
  }
}

import { DatabaseStorage } from "./databaseStorage";

// Use DatabaseStorage if DATABASE_URL is set, otherwise fall back to MemStorage
function createStorage(): IStorage {
  if (process.env.DATABASE_URL) {
    console.log("Using PostgreSQL database storage for persistence");
    return new DatabaseStorage();
  }
  console.log("Warning: DATABASE_URL not set, using in-memory storage (data will not persist)");
  return new MemStorage();
}

export const storage = createStorage();
