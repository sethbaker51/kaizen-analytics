import {
  type User,
  type InsertUser,
  type SkuUpload,
  type InsertSkuUpload,
  type SkuItem,
  type InsertSkuItem,
} from "@shared/schema";
import { randomUUID } from "crypto";

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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private skuUploads: Map<string, SkuUpload>;
  private skuItems: Map<string, SkuItem>;

  constructor() {
    this.users = new Map();
    this.skuUploads = new Map();
    this.skuItems = new Map();
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
}

export const storage = new MemStorage();
