import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, type SupplierOrderFilters } from "./storage";
import { log } from "./log";
import { csvSkuRowSchema, csvSupplierWhitelistRowSchema, type InsertSkuItem } from "@shared/schema";
import * as gmail from "./gmail";
import * as emailSync from "./emailSync";
import { isSupplierOrderEmail, extractSupplierName, extractSupplierEmail, COURIER_DOMAINS, isCourierDomain } from "./emailParser";

// SP-API configuration
const LWA_TOKEN_ENDPOINT = "https://api.amazon.com/auth/o2/token";
const SP_API_BASE_URL_NA = "https://sellingpartnerapi-na.amazon.com";

interface LWATokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface SPAPIError {
  errors?: Array<{
    code: string;
    message: string;
    details?: string;
  }>;
}

async function getLWAAccessToken(): Promise<string> {
  const clientId = process.env.SP_API_CLIENT_ID;
  const clientSecret = process.env.SP_API_CLIENT_SECRET;
  const refreshToken = process.env.SP_API_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing SP-API credentials. Please set SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, and SP_API_REFRESH_TOKEN environment variables.");
  }

  log(`Requesting LWA token from: ${LWA_TOKEN_ENDPOINT}`, "sp-api");

  const response = await fetch(LWA_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  const responseText = await response.text();
  log(`LWA Response Status: ${response.status}`, "sp-api");
  log(`LWA Response Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`, "sp-api");

  // Check if response is HTML (error page)
  if (responseText.trim().startsWith("<!") || responseText.trim().startsWith("<html")) {
    log(`LWA Error: Received HTML response instead of JSON`, "sp-api");
    log(`LWA HTML Response (first 500 chars): ${responseText.substring(0, 500)}`, "sp-api");
    throw new Error("LWA token endpoint returned HTML instead of JSON. This may indicate an incorrect endpoint URL or network issue.");
  }

  let data: LWATokenResponse;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    log(`LWA Error: Failed to parse JSON response: ${responseText.substring(0, 500)}`, "sp-api");
    throw new Error(`Failed to parse LWA response as JSON: ${responseText.substring(0, 200)}`);
  }

  if (!response.ok) {
    log(`LWA Error Response: ${JSON.stringify(data)}`, "sp-api");
    throw new Error(`LWA token request failed: ${JSON.stringify(data)}`);
  }

  log(`LWA token obtained successfully`, "sp-api");
  return data.access_token;
}

async function callSPAPI(accessToken: string, endpoint: string): Promise<any> {
  const fullUrl = `${SP_API_BASE_URL_NA}${endpoint}`;
  log(`Calling SP-API: ${fullUrl}`, "sp-api");

  const response = await fetch(fullUrl, {
    method: "GET",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
  });

  const responseText = await response.text();
  log(`SP-API Response Status: ${response.status}`, "sp-api");

  if (responseText.trim().startsWith("<!") || responseText.trim().startsWith("<html")) {
    log(`SP-API Error: Received HTML response instead of JSON`, "sp-api");
    log(`SP-API HTML Response (first 500 chars): ${responseText.substring(0, 500)}`, "sp-api");
    throw new Error("SP-API endpoint returned HTML instead of JSON.");
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    log(`SP-API Error: Failed to parse JSON response: ${responseText.substring(0, 500)}`, "sp-api");
    throw new Error(`Failed to parse SP-API response as JSON: ${responseText.substring(0, 200)}`);
  }

  if (!response.ok) {
    log(`SP-API Error Response: ${JSON.stringify(data)}`, "sp-api");
    const apiError = data as SPAPIError;
    const errorMessage = apiError.errors?.[0]?.message || JSON.stringify(data);
    throw new Error(`SP-API request failed (${response.status}): ${errorMessage}`);
  }

  return data;
}

async function testSPAPIConnection(accessToken: string): Promise<any> {
  return callSPAPI(accessToken, "/sellers/v1/marketplaceParticipations");
}

function getDateRange(range: string): { startDate: string; endDate: string } {
  // Use Pacific Time to match Amazon Seller Central's timezone
  const now = new Date();
  const pacificTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const endDate = pacificTime.toISOString().split("T")[0];
  let startDate: string;

  switch (range) {
    case "today":
      startDate = endDate;
      break;
    case "7days":
      const sevenDaysAgo = new Date(pacificTime);
      sevenDaysAgo.setDate(pacificTime.getDate() - 7);
      startDate = sevenDaysAgo.toISOString().split("T")[0];
      break;
    case "30days":
      const thirtyDaysAgo = new Date(pacificTime);
      thirtyDaysAgo.setDate(pacificTime.getDate() - 30);
      startDate = thirtyDaysAgo.toISOString().split("T")[0];
      break;
    case "60days":
      const sixtyDaysAgo = new Date(pacificTime);
      sixtyDaysAgo.setDate(pacificTime.getDate() - 60);
      startDate = sixtyDaysAgo.toISOString().split("T")[0];
      break;
    case "ytd":
      startDate = `${pacificTime.getFullYear()}-01-01`;
      break;
    case "lastyear":
      const lastYear = pacificTime.getFullYear() - 1;
      startDate = `${lastYear}-01-01`;
      return { startDate, endDate: `${lastYear}-12-31` };
    case "2years":
      const twoYearsAgo = new Date(pacificTime);
      twoYearsAgo.setFullYear(pacificTime.getFullYear() - 2);
      startDate = twoYearsAgo.toISOString().split("T")[0];
      break;
    default:
      startDate = endDate;
  }

  return { startDate, endDate };
}

async function getSalesData(
  accessToken: string,
  startDate: string,
  endDate: string,
  marketplaceIds: string[] = ["ATVPDKIKX0DER"] // US marketplace
): Promise<any> {
  // Determine if Pacific Time is currently in PST (-08:00) or PDT (-07:00)
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const pacificDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const isDST = now.getTimezoneOffset() < stdOffset ||
    pacificDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" }).includes("PDT");

  // Use -07:00 for PDT (Mar-Nov) or -08:00 for PST (Nov-Mar)
  const tzOffset = isDST ? "-07:00" : "-08:00";

  const params = new URLSearchParams({
    marketplaceIds: marketplaceIds.join(","),
    interval: `${startDate}T00:00:00${tzOffset}--${endDate}T23:59:59${tzOffset}`,
    granularity: "Total",
  });

  const endpoint = `/sales/v1/orderMetrics?${params.toString()}`;
  return callSPAPI(accessToken, endpoint);
}

// SP-API POST request helper
async function callSPAPIPost(accessToken: string, endpoint: string, body: any): Promise<any> {
  const fullUrl = `${SP_API_BASE_URL_NA}${endpoint}`;
  log(`Calling SP-API POST: ${fullUrl}`, "sp-api");

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  log(`SP-API POST Response Status: ${response.status}`, "sp-api");

  if (responseText.trim().startsWith("<!") || responseText.trim().startsWith("<html")) {
    log(`SP-API Error: Received HTML response instead of JSON`, "sp-api");
    throw new Error("SP-API endpoint returned HTML instead of JSON.");
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    log(`SP-API Error: Failed to parse JSON response: ${responseText.substring(0, 500)}`, "sp-api");
    throw new Error(`Failed to parse SP-API response as JSON: ${responseText.substring(0, 200)}`);
  }

  if (!response.ok) {
    log(`SP-API Error Response: ${JSON.stringify(data)}`, "sp-api");
    const apiError = data as SPAPIError;
    const errorMessage = apiError.errors?.[0]?.message || JSON.stringify(data);
    throw new Error(`SP-API request failed (${response.status}): ${errorMessage}`);
  }

  return data;
}

// Feeds API helpers
async function createFeedDocument(accessToken: string): Promise<{ feedDocumentId: string; url: string }> {
  const body = {
    contentType: "application/json; charset=UTF-8",
  };

  const result = await callSPAPIPost(accessToken, "/feeds/2021-06-30/documents", body);
  return {
    feedDocumentId: result.feedDocumentId,
    url: result.url,
  };
}

async function uploadFeedContent(url: string, content: string): Promise<void> {
  log(`Uploading feed content to pre-signed URL`, "sp-api");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: content,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload feed content: ${response.status} - ${text}`);
  }

  log(`Feed content uploaded successfully`, "sp-api");
}

async function createFeed(
  accessToken: string,
  feedDocumentId: string,
  marketplaceIds: string[] = ["ATVPDKIKX0DER"]
): Promise<{ feedId: string }> {
  const body = {
    feedType: "JSON_LISTINGS_FEED",
    marketplaceIds,
    inputFeedDocumentId: feedDocumentId,
  };

  const result = await callSPAPIPost(accessToken, "/feeds/2021-06-30/feeds", body);
  return { feedId: result.feedId };
}

async function getFeedStatus(accessToken: string, feedId: string): Promise<{
  processingStatus: string;
  resultFeedDocumentId?: string;
}> {
  const result = await callSPAPI(accessToken, `/feeds/2021-06-30/feeds/${feedId}`);
  return {
    processingStatus: result.processingStatus,
    resultFeedDocumentId: result.resultFeedDocumentId,
  };
}

async function getFeedResultDocument(accessToken: string, feedResultDocumentId: string): Promise<any> {
  const docInfo = await callSPAPI(accessToken, `/feeds/2021-06-30/documents/${feedResultDocumentId}`);

  log(`Feed document info: ${JSON.stringify(docInfo)}`, "sp-api");

  // Download the actual result from the URL
  const response = await fetch(docInfo.url);
  if (!response.ok) {
    throw new Error(`Failed to download feed result: ${response.status}`);
  }

  let text: string;

  // Check if the document is compressed
  if (docInfo.compressionAlgorithm === "GZIP") {
    const { gunzipSync } = await import("zlib");
    const buffer = Buffer.from(await response.arrayBuffer());
    text = gunzipSync(buffer).toString("utf-8");
    log(`Decompressed feed result (first 500 chars): ${text.substring(0, 500)}`, "sp-api");
  } else {
    text = await response.text();
    log(`Feed result (first 500 chars): ${text.substring(0, 500)}`, "sp-api");
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// Convert SKU items to JSON_LISTINGS_FEED format
// Using LISTING_OFFER_ONLY since we're adding offers to existing ASINs, not creating products
function convertToListingsFeed(items: Array<{
  sku: string;
  asin: string;
  price?: string | null;
  quantity?: number | null;
  condition?: string | null;
  fulfillmentChannel?: string | null;
  batteriesRequired?: string | null;
  areBatteriesIncluded?: string | null;
  supplierDeclaredDgHzRegulation?: string | null;
}>, sellerId: string): object {
  const messages = items.map((item, index) => {
    const conditionMap: Record<string, string> = {
      new: "new_new",
      used: "used_acceptable",
      refurbished: "refurbished_refurbished",
    };

    // Map supplier_declared_dg_hz_regulation to API format (lowercase with underscores)
    const dgHzMap: Record<string, string> = {
      "Not Applicable": "not_applicable",
      "not applicable": "not_applicable",
      "N/A": "not_applicable",
    };

    const attributes: Record<string, any> = {
      // Link to existing ASIN
      merchant_suggested_asin: [{
        value: item.asin,
        marketplace_id: "ATVPDKIKX0DER",
      }],
      condition_type: [{
        value: conditionMap[item.condition || "new"] || "new_new",
        marketplace_id: "ATVPDKIKX0DER",
      }],
      // FBA dangerous goods fields
      batteries_required: [{
        value: item.batteriesRequired === "true",
        marketplace_id: "ATVPDKIKX0DER",
      }],
      supplier_declared_dg_hz_regulation: [{
        value: dgHzMap[item.supplierDeclaredDgHzRegulation || "Not Applicable"] || "not_applicable",
        marketplace_id: "ATVPDKIKX0DER",
      }],
      // FBA fulfillment channel
      fulfillment_availability: [{
        fulfillment_channel_code: "AMAZON_NA",
      }],
    };

    if (item.price) {
      attributes.purchasable_offer = [{
        currency: "USD",
        marketplace_id: "ATVPDKIKX0DER",
        our_price: [{
          schedule: [{
            value_with_tax: parseFloat(item.price),
          }],
        }],
      }];
    }

    return {
      messageId: index + 1,
      sku: item.sku,
      operationType: "UPDATE",
      productType: "PRODUCT",
      requirements: "LISTING_OFFER_ONLY",
      attributes,
    };
  });

  return {
    header: {
      sellerId,
      version: "2.0",
      issueLocale: "en_US",
    },
    messages,
  };
}

// Column name mappings from legacy Amazon flat files to our format
const COLUMN_ALIASES: Record<string, string> = {
  "product-id": "asin",
  "product_id": "asin",
  "productid": "asin",
  "item-sku": "sku",
  "item_sku": "sku",
  "seller-sku": "sku",
  "seller_sku": "sku",
  "standard-price": "price",
  "standard_price": "price",
  "your-price": "price",
  "your_price": "price",
  "fulfillment-center-id": "fulfillment_center_id",
  "batteries-required": "batteries_required",
  "are-batteries-included": "are_batteries_included",
  "supplier-declared-dg-hz-regulation1": "supplier_declared_dg_hz_regulation",
  "supplier-declared-dg-hz-regulation": "supplier_declared_dg_hz_regulation",
};

// CSV/TSV parsing helper - auto-detects delimiter
function parseDelimitedFile(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("File must have a header row and at least one data row");
  }

  // Auto-detect delimiter: check if first line has more tabs than commas
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  // Parse headers and normalize names (apply aliases)
  const rawHeaders = firstLine.split(delimiter).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const headers = rawHeaders.map((h) => COLUMN_ALIASES[h] || h);

  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const values = line.split(delimiter).map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || "";
    });

    // Handle product-id-type: if it's "1" or "ASIN", the product-id is an ASIN
    if (row.asin && rawHeaders.includes("product-id-type")) {
      const productIdType = values[rawHeaders.indexOf("product-id-type")]?.trim().toUpperCase();
      // product-id-type: 1=ASIN, 2=ISBN, 3=UPC, 4=EAN
      // Only use product-id as ASIN if type is 1 or "ASIN"
      if (productIdType !== "1" && productIdType !== "ASIN") {
        // Not an ASIN, clear it so validation fails appropriately
        row.asin = "";
      }
    }

    rows.push(row);
  }

  return { headers, rows };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // SP-API connection test endpoint
  app.get("/api/test-connection", async (req, res) => {
    log("Starting SP-API connection test", "sp-api");

    try {
      // Step 1: Get LWA access token
      const accessToken = await getLWAAccessToken();

      // Step 2: Test SP-API connection
      const result = await testSPAPIConnection(accessToken);

      res.json({
        success: true,
        message: "SP-API connection successful",
        endpoints: {
          lwa: LWA_TOKEN_ENDPOINT,
          spApi: SP_API_BASE_URL_NA,
        },
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`SP-API connection test failed: ${errorMessage}`, "sp-api");

      res.status(500).json({
        success: false,
        error: errorMessage,
        endpoints: {
          lwa: LWA_TOKEN_ENDPOINT,
          spApi: SP_API_BASE_URL_NA,
        },
      });
    }
  });

  // Sales data endpoint
  app.get("/api/sales", async (req, res) => {
    const range = (req.query.range as string) || "today";
    log(`Fetching sales data for range: ${range}`, "sp-api");

    try {
      const accessToken = await getLWAAccessToken();
      const { startDate, endDate } = getDateRange(range);

      log(`Date range: ${startDate} to ${endDate}`, "sp-api");

      const salesData = await getSalesData(accessToken, startDate, endDate);

      // Extract the metrics from the response
      const metrics = salesData.payload?.[0] || {};

      res.json({
        success: true,
        range,
        startDate,
        endDate,
        data: {
          totalSales: metrics.totalSales?.amount || 0,
          currency: metrics.totalSales?.currencyCode || "USD",
          unitCount: metrics.unitCount || 0,
          orderCount: metrics.orderCount || 0,
          averageUnitPrice: metrics.averageSellingPrice?.amount || 0,
          averageSellingPrice: metrics.averageUnitPrice?.amount || 0,
        },
        raw: salesData,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Sales data fetch failed: ${errorMessage}`, "sp-api");

      res.status(500).json({
        success: false,
        error: errorMessage,
        range,
      });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // SKU Upload: Download CSV template
  app.get("/api/sku-upload/template", (req, res) => {
    const template = `sku,asin,price,quantity,condition,batteries_required,are_batteries_included,supplier_declared_dg_hz_regulation
MY-SKU-001,B08N5WRWNW,19.99,100,new,false,false,Not Applicable
MY-SKU-002,B07XJ8C8F5,29.99,50,new,true,true,Not Applicable`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sku-upload-template.csv");
    res.send(template);
  });

  // SKU Upload: Validate CSV
  app.post("/api/sku-upload/validate", async (req, res) => {
    try {
      const { csvContent } = req.body;

      if (!csvContent || typeof csvContent !== "string") {
        return res.status(400).json({
          success: false,
          error: "CSV content is required",
        });
      }

      const { headers, rows } = parseDelimitedFile(csvContent);

      // Check required headers
      const requiredHeaders = ["sku", "asin"];
      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Missing required columns: ${missingHeaders.join(", ")}`,
        });
      }

      // Validate each row
      const validRows: Array<{
        sku: string;
        asin: string;
        price?: string;
        quantity?: number;
        condition?: string;
        batteries_required?: string;
        are_batteries_included?: string;
        supplier_declared_dg_hz_regulation?: string;
      }> = [];
      const errors: Array<{ row: number; errors: string[] }> = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Helper to get value or undefined if empty/whitespace
        const getVal = (val: string | undefined): string | undefined => {
          const trimmed = val?.trim();
          return trimmed && trimmed.length > 0 ? trimmed : undefined;
        };

        const result = csvSkuRowSchema.safeParse({
          sku: getVal(row.sku),
          asin: getVal(row.asin),
          price: getVal(row.price),
          quantity: getVal(row.quantity) ? parseInt(row.quantity) : undefined,
          condition: getVal(row.condition),
          batteries_required: getVal(row.batteries_required),
          are_batteries_included: getVal(row.are_batteries_included),
          supplier_declared_dg_hz_regulation: getVal(row.supplier_declared_dg_hz_regulation),
        });

        if (result.success) {
          validRows.push(result.data);
        } else {
          errors.push({
            row: i + 2, // +2 for 1-indexed and header row
            errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
          });
        }
      }

      res.json({
        success: true,
        data: {
          totalRows: rows.length,
          validRows: validRows.length,
          errorCount: errors.length,
          errors: errors.slice(0, 10), // Limit errors shown
          preview: validRows.slice(0, 5),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`CSV validation failed: ${errorMessage}`, "sku-upload");
      res.status(400).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Upload: Submit to Amazon
  app.post("/api/sku-upload/submit", async (req, res) => {
    try {
      const { csvContent, filename } = req.body;

      if (!csvContent || typeof csvContent !== "string") {
        return res.status(400).json({
          success: false,
          error: "CSV content is required",
        });
      }

      // Parse and validate CSV
      const { rows } = parseDelimitedFile(csvContent);
      const validItems: InsertSkuItem[] = [];
      const parseErrors: string[] = [];

      // Helper to get value or undefined if empty/whitespace
      const getVal = (val: string | undefined): string | undefined => {
        const trimmed = val?.trim();
        return trimmed && trimmed.length > 0 ? trimmed : undefined;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const result = csvSkuRowSchema.safeParse({
          sku: getVal(row.sku),
          asin: getVal(row.asin),
          price: getVal(row.price),
          quantity: getVal(row.quantity) ? parseInt(row.quantity) : undefined,
          condition: getVal(row.condition),
          batteries_required: getVal(row.batteries_required),
          are_batteries_included: getVal(row.are_batteries_included),
          supplier_declared_dg_hz_regulation: getVal(row.supplier_declared_dg_hz_regulation),
        });

        if (result.success) {
          validItems.push({
            uploadId: "", // Will be set after creating upload record
            sku: result.data.sku,
            asin: result.data.asin,
            price: result.data.price || null,
            quantity: result.data.quantity ?? null,
            condition: result.data.condition || "new",
            // FBA fields - always FBA, with sensible defaults
            fulfillmentChannel: "FBA",
            batteriesRequired: result.data.batteries_required || "false",
            areBatteriesIncluded: result.data.are_batteries_included || "false",
            supplierDeclaredDgHzRegulation: result.data.supplier_declared_dg_hz_regulation || "Not Applicable",
            status: "pending",
          });
        } else {
          parseErrors.push(`Row ${i + 2}: ${result.error.errors.map((e) => e.message).join(", ")}`);
        }
      }

      if (validItems.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No valid rows found in CSV",
          parseErrors,
        });
      }

      // Create upload record
      const upload = await storage.createSkuUpload({
        filename: filename || `upload-${Date.now()}.csv`,
        status: "submitting",
        totalItems: validItems.length,
      });

      // Set uploadId on items and create them
      const itemsWithUploadId = validItems.map((item) => ({
        ...item,
        uploadId: upload.id,
      }));
      await storage.createSkuItems(itemsWithUploadId);

      // Get seller ID from SP-API
      log(`Starting SKU submission for upload ${upload.id}`, "sku-upload");

      try {
        const accessToken = await getLWAAccessToken();

        // Get seller ID from marketplace participations
        const participations = await callSPAPI(accessToken, "/sellers/v1/marketplaceParticipations");
        log(`Marketplace participations response: ${JSON.stringify(participations)}`, "sku-upload");

        // Try different paths where seller ID might be located
        let sellerId = participations.payload?.[0]?.seller?.sellerId;

        // Alternative paths based on different API response structures
        if (!sellerId && participations.payload?.[0]?.participation?.sellerId) {
          sellerId = participations.payload[0].participation.sellerId;
        }
        if (!sellerId && participations[0]?.seller?.sellerId) {
          sellerId = participations[0].seller.sellerId;
        }
        if (!sellerId && participations[0]?.participation?.sellerId) {
          sellerId = participations[0].participation.sellerId;
        }

        // Check for seller ID in environment as fallback
        if (!sellerId) {
          sellerId = process.env.SP_API_SELLER_ID || "A1QO8EE1RAHPLZ";
        }

        if (!sellerId) {
          throw new Error("Could not determine seller ID from SP-API. Please set SP_API_SELLER_ID environment variable.");
        }

        log(`Using seller ID: ${sellerId}`, "sku-upload");

        // Create feed document
        const feedDoc = await createFeedDocument(accessToken);
        await storage.updateSkuUpload(upload.id, { feedDocumentId: feedDoc.feedDocumentId });

        // Convert to JSON_LISTINGS_FEED format and upload
        const feedContent = convertToListingsFeed(validItems, sellerId);
        await uploadFeedContent(feedDoc.url, JSON.stringify(feedContent));

        // Create feed
        const feed = await createFeed(accessToken, feedDoc.feedDocumentId);
        await storage.updateSkuUpload(upload.id, {
          feedId: feed.feedId,
          status: "processing",
        });

        log(`Feed submitted successfully: ${feed.feedId}`, "sku-upload");

        res.json({
          success: true,
          message: `Submitted ${validItems.length} SKUs to Amazon`,
          data: {
            uploadId: upload.id,
            feedId: feed.feedId,
            totalItems: validItems.length,
            status: "processing",
          },
        });
      } catch (spApiError) {
        const errorMessage = spApiError instanceof Error ? spApiError.message : String(spApiError);
        await storage.updateSkuUpload(upload.id, {
          status: "failed",
          errorMessage,
        });
        throw spApiError;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`SKU submission failed: ${errorMessage}`, "sku-upload");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Upload: Get upload history
  app.get("/api/sku-uploads", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const uploads = await storage.getSkuUploads(limit, offset);

      res.json({
        success: true,
        data: uploads,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Upload: Get upload details
  app.get("/api/sku-upload/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const upload = await storage.getSkuUpload(id);
      if (!upload) {
        return res.status(404).json({
          success: false,
          error: "Upload not found",
        });
      }

      const items = await storage.getSkuItemsByUploadId(id);

      res.json({
        success: true,
        data: {
          ...upload,
          items,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Upload: Check status and poll Amazon if processing
  app.get("/api/sku-upload/:id/status", async (req, res) => {
    try {
      const { id } = req.params;

      const upload = await storage.getSkuUpload(id);
      if (!upload) {
        return res.status(404).json({
          success: false,
          error: "Upload not found",
        });
      }

      // If still processing, check with Amazon
      if (upload.status === "processing" && upload.feedId) {
        try {
          const accessToken = await getLWAAccessToken();
          const feedStatus = await getFeedStatus(accessToken, upload.feedId);

          log(`Feed ${upload.feedId} status: ${feedStatus.processingStatus}`, "sku-upload");

          if (feedStatus.processingStatus === "DONE") {
            // Get results
            let successCount = 0;
            let errorCount = 0;
            let feedResultJson: string | null = null;

            if (feedStatus.resultFeedDocumentId) {
              try {
                const results = await getFeedResultDocument(accessToken, feedStatus.resultFeedDocumentId);
                // Store the full result JSON for download
                feedResultJson = JSON.stringify(results, null, 2);
                // Parse results and update item statuses
                // The result format varies, so we'll do basic parsing
                if (results.summary) {
                  successCount = results.summary.messagesProcessed - (results.summary.messagesWithError || 0);
                  errorCount = results.summary.messagesWithError || 0;
                }
              } catch (resultError) {
                log(`Failed to get feed results: ${resultError}`, "sku-upload");
              }
            }

            await storage.updateSkuUpload(id, {
              status: "completed",
              successCount,
              errorCount,
              feedResult: feedResultJson,
            });

            const updatedUpload = await storage.getSkuUpload(id);
            return res.json({
              success: true,
              data: updatedUpload,
            });
          } else if (feedStatus.processingStatus === "FATAL" || feedStatus.processingStatus === "CANCELLED") {
            await storage.updateSkuUpload(id, {
              status: "failed",
              errorMessage: `Feed processing ${feedStatus.processingStatus.toLowerCase()}`,
            });

            const updatedUpload = await storage.getSkuUpload(id);
            return res.json({
              success: true,
              data: updatedUpload,
            });
          }
        } catch (spApiError) {
          log(`Failed to check feed status: ${spApiError}`, "sku-upload");
          // Don't fail the request, just return current status
        }
      }

      res.json({
        success: true,
        data: upload,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Upload: Download processing report
  app.get("/api/sku-upload/:id/report", async (req, res) => {
    try {
      const { id } = req.params;

      const upload = await storage.getSkuUpload(id);
      if (!upload) {
        return res.status(404).json({
          success: false,
          error: "Upload not found",
        });
      }

      if (!upload.feedResult) {
        return res.status(404).json({
          success: false,
          error: "No processing report available yet",
        });
      }

      // Return as downloadable JSON file
      const filename = `processing-report-${upload.feedId || id}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.send(upload.feedResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Delete: Delete single SKU (close first, then delete)
  app.post("/api/sku/delete", async (req, res) => {
    try {
      const { sku } = req.body;

      if (!sku || typeof sku !== "string") {
        return res.status(400).json({
          success: false,
          error: "SKU is required",
        });
      }

      log(`Closing and deleting single SKU: ${sku}`, "sku-delete");

      // Create upload record for tracking
      const upload = await storage.createSkuUpload({
        filename: `delete-${sku}`,
        status: "submitting",
        totalItems: 1,
      });

      const accessToken = await getLWAAccessToken();
      const sellerId = process.env.SP_API_SELLER_ID || "A1QO8EE1RAHPLZ";

      // Step 1: Close the listing (set quantity to 0)
      const closeFeedDoc = await createFeedDocument(accessToken);
      const closeFeed = {
        header: {
          sellerId,
          version: "2.0",
          issueLocale: "en_US",
        },
        messages: [{
          messageId: 1,
          sku: sku,
          operationType: "PATCH",
          productType: "PRODUCT",
          patches: [{
            op: "replace",
            path: "/attributes/fulfillment_availability",
            value: [{
              fulfillment_channel_code: "AMAZON_NA",
              quantity: 0,
            }],
          }],
        }],
      };

      await uploadFeedContent(closeFeedDoc.url, JSON.stringify(closeFeed));
      const closeResult = await createFeed(accessToken, closeFeedDoc.feedDocumentId);
      log(`Close feed submitted: ${closeResult.feedId}`, "sku-delete");

      // Step 2: Delete the listing
      const deleteFeedDoc = await createFeedDocument(accessToken);
      const deleteFeed = {
        header: {
          sellerId,
          version: "2.0",
          issueLocale: "en_US",
        },
        messages: [{
          messageId: 1,
          sku: sku,
          operationType: "DELETE",
        }],
      };

      await uploadFeedContent(deleteFeedDoc.url, JSON.stringify(deleteFeed));
      const deleteResult = await createFeed(accessToken, deleteFeedDoc.feedDocumentId);
      log(`Delete feed submitted: ${deleteResult.feedId}`, "sku-delete");

      // Track both feeds - store close feed ID in errorMessage field temporarily for reference
      await storage.updateSkuUpload(upload.id, {
        feedDocumentId: deleteFeedDoc.feedDocumentId,
        feedId: deleteResult.feedId,
        status: "processing",
        errorMessage: `Close Feed: ${closeResult.feedId}`, // Store close feed ID for reference
      });

      res.json({
        success: true,
        message: `Close and delete requests submitted for SKU: ${sku}`,
        data: {
          uploadId: upload.id,
          closeFeedId: closeResult.feedId,
          deleteFeedId: deleteResult.feedId,
          sku,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`SKU delete failed: ${errorMessage}`, "sku-delete");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Orders: Get orders by date range
  app.get("/api/orders", async (req, res) => {
    try {
      const { startDate, endDate, status } = req.query;

      // Default to last 7 days if no dates provided
      // SP-API requires CreatedBefore to be at least 2 minutes in the past
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000); // 3 minutes buffer to be safe
      const defaultEnd = twoMinutesAgo.toISOString();
      const defaultStart = new Date(twoMinutesAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const createdAfter = (startDate as string) || defaultStart;
      // Ensure createdBefore is at least 2 minutes in the past
      let createdBefore = (endDate as string) || defaultEnd;
      if (new Date(createdBefore) > twoMinutesAgo) {
        createdBefore = twoMinutesAgo.toISOString();
      }

      log(`Fetching orders from ${createdAfter} to ${createdBefore}`, "orders");

      const accessToken = await getLWAAccessToken();

      const params = new URLSearchParams({
        MarketplaceIds: "ATVPDKIKX0DER", // US marketplace
        CreatedAfter: createdAfter,
        CreatedBefore: createdBefore,
      });

      // Add optional status filter
      if (status && typeof status === "string" && status !== "all") {
        params.set("OrderStatuses", status);
      }

      const endpoint = `/orders/v0/orders?${params.toString()}`;
      const result = await callSPAPI(accessToken, endpoint);

      const orders = result.payload?.Orders || [];
      const hasMore = !!result.payload?.NextToken;

      log(`Fetched ${orders.length} orders, hasMore: ${hasMore}`, "orders");

      // Fetch order items for each order (with rate limiting)
      const ordersWithItems = [];
      for (const order of orders) {
        try {
          const itemsEndpoint = `/orders/v0/orders/${order.AmazonOrderId}/orderItems`;
          const itemsResult = await callSPAPI(accessToken, itemsEndpoint);
          const items = itemsResult.payload?.OrderItems || [];

          // Calculate total from items if OrderTotal not available
          const itemsTotal = items.reduce((sum: number, item: any) => {
            return sum + (Number(item.ItemPrice?.Amount) || 0);
          }, 0);

          ordersWithItems.push({
            ...order,
            calculatedTotal: itemsTotal,
            items: items.map((item: any) => ({
              asin: item.ASIN,
              sku: item.SellerSKU,
              title: item.Title,
              quantity: item.QuantityOrdered,
              itemPrice: item.ItemPrice?.Amount,
            })),
          });

          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (itemError) {
          // If we can't get items, still include the order without items
          log(`Failed to fetch items for order ${order.AmazonOrderId}: ${itemError}`, "orders");
          ordersWithItems.push({ ...order, items: [] });
        }
      }

      // Calculate summary stats
      const totalOrders = ordersWithItems.length;
      const pendingOrders = ordersWithItems.filter((o: any) => o.OrderStatus === "Pending").length;
      const shippedOrders = ordersWithItems.filter((o: any) => o.OrderStatus === "Shipped").length;
      const canceledOrders = ordersWithItems.filter((o: any) => o.OrderStatus === "Canceled").length;
      const unshippedOrders = ordersWithItems.filter((o: any) => o.OrderStatus === "Unshipped").length;

      // Calculate total revenue from orders (use calculated total as fallback)
      const totalRevenue = ordersWithItems.reduce((sum: number, order: any) => {
        const amount = Number(order.OrderTotal?.Amount ?? order.calculatedTotal ?? 0);
        return sum + amount;
      }, 0);

      res.json({
        success: true,
        data: {
          summary: {
            totalOrders,
            pendingOrders,
            unshippedOrders,
            shippedOrders,
            canceledOrders,
            totalRevenue,
            currency: ordersWithItems[0]?.OrderTotal?.CurrencyCode || "USD",
            hasMore,
          },
          orders: ordersWithItems.map((order: any) => ({
            orderId: order.AmazonOrderId,
            purchaseDate: order.PurchaseDate,
            lastUpdateDate: order.LastUpdateDate,
            orderStatus: order.OrderStatus,
            fulfillmentChannel: order.FulfillmentChannel,
            salesChannel: order.SalesChannel,
            orderTotal: order.OrderTotal?.Amount ?? order.calculatedTotal ?? null,
            currency: order.OrderTotal?.CurrencyCode || "USD",
            numberOfItems: order.NumberOfItemsShipped + order.NumberOfItemsUnshipped,
            itemsShipped: order.NumberOfItemsShipped,
            itemsUnshipped: order.NumberOfItemsUnshipped,
            paymentMethod: order.PaymentMethod,
            isPrime: order.IsPrime,
            isBusinessOrder: order.IsBusinessOrder,
            shipCity: order.ShippingAddress?.City,
            shipState: order.ShippingAddress?.StateOrRegion,
            shipPostalCode: order.ShippingAddress?.PostalCode,
            items: order.items || [],
          })),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Orders fetch failed: ${errorMessage}`, "orders");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Inventory: Get FBA inventory summaries (single page to avoid rate limits)
  app.get("/api/inventory", async (req, res) => {
    try {
      log("Fetching inventory data from SP-API", "inventory");

      const accessToken = await getLWAAccessToken();

      const params = new URLSearchParams({
        granularityType: "Marketplace",
        granularityId: "ATVPDKIKX0DER", // US marketplace
        marketplaceIds: "ATVPDKIKX0DER",
        details: "true",
      });

      const endpoint = `/fba/inventory/v1/summaries?${params.toString()}`;
      const result = await callSPAPI(accessToken, endpoint);

      const inventory = result.payload?.inventorySummaries || [];
      const hasMore = !!result.pagination?.nextToken;

      log(`Fetched ${inventory.length} items, hasMore: ${hasMore}`, "inventory");

      // Calculate summary stats for this page
      const pageCount = inventory.length;
      const activeOnPage = inventory.filter((item: any) => {
        const qty = Number(item.inventoryDetails?.fulfillableQuantity) || 0;
        return qty > 0;
      }).length;
      const inactiveOnPage = pageCount - activeOnPage;
      const totalFulfillable = inventory.reduce((sum: number, item: any) => {
        return sum + (Number(item.inventoryDetails?.fulfillableQuantity) || 0);
      }, 0);
      const totalInbound = inventory.reduce((sum: number, item: any) => {
        const working = Number(item.inventoryDetails?.inboundWorkingQuantity) || 0;
        const shipped = Number(item.inventoryDetails?.inboundShippedQuantity) || 0;
        const receiving = Number(item.inventoryDetails?.inboundReceivingQuantity) || 0;
        return sum + working + shipped + receiving;
      }, 0);
      const totalUnfulfillable = inventory.reduce((sum: number, item: any) => {
        return sum + (Number(item.inventoryDetails?.unfulfillableQuantity) || 0);
      }, 0);
      const totalReserved = inventory.reduce((sum: number, item: any) => {
        return sum + (Number(item.inventoryDetails?.reservedQuantity?.totalReservedQuantity) || 0);
      }, 0);

      res.json({
        success: true,
        data: {
          summary: {
            totalItems: pageCount,
            activeItems: activeOnPage,
            inactiveItems: inactiveOnPage,
            totalFulfillable,
            totalInbound,
            totalUnfulfillable,
            totalReserved,
            hasMore, // indicates there are more SKUs beyond this page
          },
          inventory: inventory.map((item: any) => ({
            asin: item.asin,
            fnSku: item.fnSku,
            sellerSku: item.sellerSku,
            productName: item.productName,
            condition: item.condition,
            lastUpdatedTime: item.lastUpdatedTime,
            totalQuantity: Number(item.totalQuantity) || 0,
            fulfillableQuantity: Number(item.inventoryDetails?.fulfillableQuantity) || 0,
            inboundWorking: Number(item.inventoryDetails?.inboundWorkingQuantity) || 0,
            inboundShipped: Number(item.inventoryDetails?.inboundShippedQuantity) || 0,
            inboundReceiving: Number(item.inventoryDetails?.inboundReceivingQuantity) || 0,
            reservedQuantity: Number(item.inventoryDetails?.reservedQuantity?.totalReservedQuantity) || 0,
            unfulfillableQuantity: Number(item.inventoryDetails?.unfulfillableQuantity) || 0,
            researchingQuantity: Number(item.inventoryDetails?.researchingQuantity) || 0,
          })),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Inventory fetch failed: ${errorMessage}`, "inventory");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // SKU Delete: Bulk delete via CSV (close first, then delete)
  app.post("/api/sku/delete-bulk", async (req, res) => {
    try {
      const { csvContent, filename } = req.body;

      if (!csvContent || typeof csvContent !== "string") {
        return res.status(400).json({
          success: false,
          error: "CSV content is required",
        });
      }

      // Parse CSV - only need SKU column
      const { headers, rows } = parseDelimitedFile(csvContent);

      if (!headers.includes("sku")) {
        return res.status(400).json({
          success: false,
          error: "CSV must have a 'sku' column",
        });
      }

      const skus = rows
        .map((row) => row.sku?.trim())
        .filter((sku) => sku && sku.length > 0);

      if (skus.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No valid SKUs found in CSV",
        });
      }

      log(`Bulk closing and deleting ${skus.length} SKUs`, "sku-delete");

      // Create upload record for tracking
      const upload = await storage.createSkuUpload({
        filename: filename || `delete-${Date.now()}.csv`,
        status: "submitting",
        totalItems: skus.length,
      });

      const accessToken = await getLWAAccessToken();
      const sellerId = process.env.SP_API_SELLER_ID || "A1QO8EE1RAHPLZ";

      // Step 1: Close all listings (set quantity to 0)
      const closeFeedDoc = await createFeedDocument(accessToken);
      const closeFeed = {
        header: {
          sellerId,
          version: "2.0",
          issueLocale: "en_US",
        },
        messages: skus.map((sku, index) => ({
          messageId: index + 1,
          sku: sku,
          operationType: "PATCH",
          productType: "PRODUCT",
          patches: [{
            op: "replace",
            path: "/attributes/fulfillment_availability",
            value: [{
              fulfillment_channel_code: "AMAZON_NA",
              quantity: 0,
            }],
          }],
        })),
      };

      await uploadFeedContent(closeFeedDoc.url, JSON.stringify(closeFeed));
      const closeResult = await createFeed(accessToken, closeFeedDoc.feedDocumentId);
      log(`Bulk close feed submitted: ${closeResult.feedId}`, "sku-delete");

      // Step 2: Delete all listings
      const deleteFeedDoc = await createFeedDocument(accessToken);
      const deleteFeed = {
        header: {
          sellerId,
          version: "2.0",
          issueLocale: "en_US",
        },
        messages: skus.map((sku, index) => ({
          messageId: index + 1,
          sku: sku,
          operationType: "DELETE",
        })),
      };

      await uploadFeedContent(deleteFeedDoc.url, JSON.stringify(deleteFeed));
      const deleteResult = await createFeed(accessToken, deleteFeedDoc.feedDocumentId);
      log(`Bulk delete feed submitted: ${deleteResult.feedId}`, "sku-delete");

      await storage.updateSkuUpload(upload.id, {
        feedDocumentId: deleteFeedDoc.feedDocumentId,
        feedId: deleteResult.feedId,
        status: "processing",
      });

      res.json({
        success: true,
        message: `Close and delete requests submitted for ${skus.length} SKUs`,
        data: {
          uploadId: upload.id,
          closeFeedId: closeResult.feedId,
          deleteFeedId: deleteResult.feedId,
          totalItems: skus.length,
          status: "processing",
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Bulk SKU delete failed: ${errorMessage}`, "sku-delete");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // ============================================================================
  // Gmail OAuth Endpoints
  // ============================================================================

  // Gmail: Check if Gmail is configured
  app.get("/api/gmail/status", (req, res) => {
    res.json({
      success: true,
      configured: gmail.isGmailConfigured(),
    });
  });

  // Gmail: Initiate OAuth flow
  app.get("/api/gmail/auth", (req, res) => {
    try {
      if (!gmail.isGmailConfigured()) {
        return res.status(400).json({
          success: false,
          error: "Gmail API credentials not configured. Please set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.",
        });
      }

      const state = Math.random().toString(36).substring(7);
      const authUrl = gmail.getAuthUrl(state);

      log(`Redirecting to Gmail OAuth: ${authUrl}`, "gmail");
      res.redirect(authUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Gmail auth initiation failed: ${errorMessage}`, "gmail");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: OAuth callback
  app.get("/api/gmail/callback", async (req, res) => {
    try {
      const { code, error: oauthError } = req.query;

      if (oauthError) {
        log(`Gmail OAuth error: ${oauthError}`, "gmail");
        return res.redirect("/settings?error=gmail_auth_denied");
      }

      if (!code || typeof code !== "string") {
        return res.redirect("/settings?error=gmail_no_code");
      }

      // Exchange code for tokens
      const tokens = await gmail.exchangeCodeForTokens(code);

      // Get user email
      const email = await gmail.getUserEmail(tokens.accessToken);

      // Check if account already exists
      const existingAccount = await storage.getGmailAccountByEmail(email);
      if (existingAccount) {
        // Update tokens
        await storage.updateGmailAccount(existingAccount.id, {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.tokenExpiry,
        });
        log(`Updated Gmail account: ${email}`, "gmail");
      } else {
        // Create new account
        await storage.createGmailAccount({
          email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiry: tokens.tokenExpiry,
          syncEnabled: true,
        });
        log(`Created Gmail account: ${email}`, "gmail");
      }

      res.redirect("/settings?success=gmail_connected");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Gmail OAuth callback failed: ${errorMessage}`, "gmail");
      res.redirect(`/settings?error=gmail_auth_failed`);
    }
  });

  // Gmail: List connected accounts
  app.get("/api/gmail/accounts", async (req, res) => {
    try {
      const accounts = await storage.getAllGmailAccounts();

      // Return accounts without sensitive token data
      res.json({
        success: true,
        data: accounts.map((account) => ({
          id: account.id,
          email: account.email,
          syncEnabled: account.syncEnabled,
          lastSyncAt: account.lastSyncAt,
          createdAt: account.createdAt,
          tokenExpiry: account.tokenExpiry,
          isTokenExpired: new Date() > account.tokenExpiry,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: Update account (toggle sync)
  app.patch("/api/gmail/accounts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { syncEnabled } = req.body;

      const account = await storage.getGmailAccount(id);
      if (!account) {
        return res.status(404).json({
          success: false,
          error: "Account not found",
        });
      }

      const updated = await storage.updateGmailAccount(id, { syncEnabled });

      res.json({
        success: true,
        data: {
          id: updated!.id,
          email: updated!.email,
          syncEnabled: updated!.syncEnabled,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: Disconnect account
  app.delete("/api/gmail/accounts/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const account = await storage.getGmailAccount(id);
      if (!account) {
        return res.status(404).json({
          success: false,
          error: "Account not found",
        });
      }

      await storage.deleteGmailAccount(id);
      log(`Disconnected Gmail account: ${account.email}`, "gmail");

      res.json({
        success: true,
        message: `Disconnected ${account.email}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: Trigger sync for all accounts
  app.post("/api/gmail/sync", async (req, res) => {
    try {
      log("Manual sync triggered for all accounts", "gmail");
      const results = await emailSync.syncAllAccounts();

      const totalEmails = results.reduce((sum, r) => sum + r.emailsProcessed, 0);
      const totalOrders = results.reduce((sum, r) => sum + r.ordersCreated, 0);

      res.json({
        success: true,
        message: `Synced ${results.length} accounts`,
        data: {
          accountsSynced: results.length,
          totalEmailsProcessed: totalEmails,
          totalOrdersCreated: totalOrders,
          results,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Sync all accounts failed: ${errorMessage}`, "gmail");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: Trigger sync for single account
  app.post("/api/gmail/accounts/:id/sync", async (req, res) => {
    try {
      const { id } = req.params;

      const account = await storage.getGmailAccount(id);
      if (!account) {
        return res.status(404).json({
          success: false,
          error: "Account not found",
        });
      }

      log(`Manual sync triggered for ${account.email}`, "gmail");
      const result = await emailSync.syncAccount(id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Sync account failed: ${errorMessage}`, "gmail");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: Discover potential suppliers from inbox
  app.post("/api/gmail/discover-suppliers", async (req, res) => {
    try {
      const accounts = await storage.getAllGmailAccounts();
      const enabledAccounts = accounts.filter((a) => a.syncEnabled);

      if (enabledAccounts.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No Gmail accounts connected. Please connect a Gmail account first.",
        });
      }

      log("Starting supplier discovery scan (optimized)", "gmail");

      // Track unique suppliers by domain
      const supplierMap = new Map<string, {
        name: string;
        emailPattern: string;
        domain: string;
        emailCount: number;
        sampleSubjects: string[];
        sampleEmails: string[];
      }>();

      // Domains to skip - personal email, marketing, social, etc.
      // Start with courier domains - these are NEVER suppliers
      const skipDomains = new Set([
        ...Array.from(COURIER_DOMAINS),
        // Personal email providers
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
        "icloud.com", "aol.com", "protonmail.com", "msn.com", "me.com",
        "mail.com", "ymail.com", "rocketmail.com", "comcast.net", "att.net",
        "verizon.net", "sbcglobal.net", "cox.net", "charter.net",
        // Marketing/Newsletter platforms
        "mailchimp.com", "constantcontact.com", "hubspot.com", "sendgrid.net",
        "sendgrid.com", "mailgun.org", "mailgun.com", "klaviyo.com",
        "omnisend.com", "drip.com", "activecampaign.com", "getresponse.com",
        "aweber.com", "convertkit.com", "sendinblue.com", "brevo.com",
        "mailerlite.com", "campaign-archive.com", "list-manage.com",
        "createsend.com", "cmail19.com", "cmail20.com", "em.sailthru.com",
        "sailthru.com", "responsys.net", "epsilon.com", "cheetahmail.com",
        "exacttarget.com", "salesforce.com", "pardot.com", "marketo.com",
        // Social media
        "facebook.com", "facebookmail.com", "twitter.com", "x.com",
        "instagram.com", "linkedin.com", "pinterest.com", "tiktok.com",
        // Payment processors (not suppliers)
        "paypal.com", "stripe.com", "square.com", "venmo.com",
        // Google services
        "google.com", "youtube.com", "accounts.google.com",
        // Other common non-suppliers
        "noreply.github.com", "github.com", "gitlab.com",
        "zoom.us", "slack.com", "notion.so", "dropbox.com",
        "spotify.com", "netflix.com", "apple.com",
      ]);

      // Pattern to detect marketing/unsubscribe emails
      const marketingPatterns = [
        /unsubscribe/i, /opt.?out/i, /email preferences/i,
        /manage.*subscription/i, /update.*preferences/i,
        /newsletter/i, /weekly digest/i, /daily digest/i,
        /promotional/i, /special offer/i, /limited time/i,
        /exclusive deal/i, /% off/i, /sale ends/i,
        /don't miss/i, /act now/i, /hurry/i,
      ];

      // Query excluding promotions, social, and forums
      // Using keywords in subject AND excluding promotional categories
      const discoveryQuery = [
        "subject:(order OR confirmation OR shipped OR tracking OR delivery OR invoice OR receipt OR dispatch OR shipment)",
        "-category:promotions",
        "-category:social",
        "-category:forums",
        "-subject:newsletter",
        "-subject:unsubscribe",
        "-subject:\"special offer\"",
        "-subject:\"limited time\"",
        "newer_than:90d",
      ].join(" ");

      for (const account of enabledAccounts) {
        try {
          // Refresh token if needed
          const expiryBuffer = 5 * 60 * 1000;
          let accessToken = account.accessToken;

          if (new Date() > new Date(account.tokenExpiry.getTime() - expiryBuffer)) {
            const tokens = await gmail.refreshAccessToken(account.refreshToken);
            await storage.updateGmailAccount(account.id, {
              accessToken: tokens.accessToken,
              tokenExpiry: tokens.tokenExpiry,
            });
            accessToken = tokens.accessToken;
          }

          // Step 1: Fetch email list (just IDs) - can get many more this way
          const emails = await gmail.getEmailList(accessToken, discoveryQuery, 2000);
          log(`Found ${emails.length} potential emails to scan`, "gmail");

          if (emails.length === 0) continue;

          // Step 2: Batch fetch metadata (headers only) - much faster than full content
          log(`Fetching metadata for ${emails.length} emails...`, "gmail");
          const metadata = await gmail.batchGetEmailMetadata(
            accessToken,
            emails.map((e) => e.id)
          );
          log(`Retrieved metadata for ${metadata.length} emails`, "gmail");

          // Step 3: Group by domain and collect sample subjects
          const domainEmails = new Map<string, typeof metadata>();

          for (const email of metadata) {
            const supplierEmail = extractSupplierEmail(email.from);
            if (!supplierEmail) continue;

            const atIndex = supplierEmail.indexOf("@");
            if (atIndex === -1) continue;
            const domain = supplierEmail.substring(atIndex + 1).toLowerCase();

            // Skip known non-supplier domains
            if (skipDomains.has(domain)) continue;

            // Skip if subject looks like marketing
            const isMarketing = marketingPatterns.some((p) => p.test(email.subject));
            if (isMarketing) continue;

            const existing = domainEmails.get(domain);
            if (existing) {
              existing.push(email);
            } else {
              domainEmails.set(domain, [email]);
            }
          }

          log(`Found ${domainEmails.size} unique sender domains`, "gmail");

          // Step 4: For each domain, verify it looks like a supplier by checking a sample
          for (const [domain, domainMetadata] of domainEmails) {
            // Get sample emails for this domain
            const samples = domainMetadata.slice(0, 5);
            const sampleSubjects = [...new Set(samples.map((s) => s.subject))].slice(0, 3);
            const sampleEmails = [...new Set(samples.map((s) => extractSupplierEmail(s.from)))].filter(Boolean) as string[];

            // Use the first email's sender name
            const supplierName = extractSupplierName(samples[0].from) ||
              domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);

            // Verify at least one email looks like a supplier order
            // by fetching full content for one sample
            let isValidSupplier = false;
            for (const sample of samples.slice(0, 2)) {
              try {
                const fullContent = await gmail.getEmailContent(accessToken, sample.id);
                if (isSupplierOrderEmail(fullContent.subject, fullContent.body)) {
                  isValidSupplier = true;
                  break;
                }
              } catch {
                continue;
              }
            }

            if (!isValidSupplier) continue;

            // Update or create supplier entry
            const existing = supplierMap.get(domain);
            if (existing) {
              existing.emailCount += domainMetadata.length;
              for (const subj of sampleSubjects) {
                if (existing.sampleSubjects.length < 3 && !existing.sampleSubjects.includes(subj)) {
                  existing.sampleSubjects.push(subj);
                }
              }
              for (const email of sampleEmails) {
                if (!existing.sampleEmails.includes(email)) {
                  existing.sampleEmails.push(email);
                }
              }
            } else {
              supplierMap.set(domain, {
                name: supplierName,
                emailPattern: `@${domain}`,
                domain,
                emailCount: domainMetadata.length,
                sampleSubjects,
                sampleEmails,
              });
            }
          }
        } catch (accountError) {
          log(`Error scanning account ${account.email}: ${accountError}`, "gmail");
        }
      }

      // Get existing whitelist to mark already-added suppliers
      const existingWhitelist = await storage.getAllSupplierWhitelist();
      const existingDomains = new Set(existingWhitelist.map((e) => e.domain?.toLowerCase()).filter(Boolean));

      // Convert to array and sort by email count
      const suggestions = Array.from(supplierMap.values())
        .map((s) => ({
          ...s,
          alreadyWhitelisted: existingDomains.has(s.domain),
        }))
        .sort((a, b) => b.emailCount - a.emailCount);

      log(`Discovered ${suggestions.length} potential suppliers`, "gmail");

      res.json({
        success: true,
        data: {
          suppliers: suggestions,
          totalFound: suggestions.length,
          alreadyWhitelisted: suggestions.filter((s) => s.alreadyWhitelisted).length,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Supplier discovery failed: ${errorMessage}`, "gmail");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Gmail: Bulk add discovered suppliers to whitelist
  app.post("/api/gmail/add-discovered-suppliers", async (req, res) => {
    try {
      const { suppliers } = req.body;

      if (!Array.isArray(suppliers) || suppliers.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No suppliers provided",
        });
      }

      const results = {
        added: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (const supplier of suppliers) {
        try {
          // Check if already exists
          const existing = await storage.getAllSupplierWhitelist();
          const alreadyExists = existing.some(
            (e) => e.domain?.toLowerCase() === supplier.domain?.toLowerCase()
          );

          if (alreadyExists) {
            results.skipped++;
            continue;
          }

          await storage.createSupplierWhitelist({
            name: supplier.name,
            emailPattern: supplier.emailPattern,
            notes: `Auto-discovered from inbox (${supplier.emailCount} emails)`,
            isActive: true,
          });
          results.added++;
        } catch (error) {
          results.errors.push(`${supplier.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      log(`Added ${results.added} suppliers to whitelist (${results.skipped} skipped)`, "whitelist");

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // ============================================================================
  // Supplier Orders Endpoints
  // ============================================================================

  // Supplier Orders: Get orders with filters
  app.get("/api/supplier-orders", async (req, res) => {
    try {
      const { status, startDate, endDate, supplier, flagged, search, limit, offset } = req.query;

      const filters: SupplierOrderFilters = {
        status: status as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        supplier: supplier as string,
        isFlagged: flagged === "true" ? true : flagged === "false" ? false : undefined,
        search: search as string,
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
      };

      const [ordersResult, stats, gmailAccounts] = await Promise.all([
        storage.getSupplierOrders(filters),
        storage.getSupplierOrderStats(),
        storage.getAllGmailAccounts(),
      ]);

      // Create a lookup map for Gmail account emails
      const gmailEmailMap = new Map(gmailAccounts.map(a => [a.id, a.email]));

      // Add Gmail account email to each order for proper email linking
      const ordersWithEmail = ordersResult.orders.map(order => ({
        ...order,
        gmailAccountEmail: gmailEmailMap.get(order.gmailAccountId) || null,
      }));

      res.json({
        success: true,
        summary: stats,
        data: ordersWithEmail,
        pagination: {
          total: ordersResult.total,
          limit: filters.limit ?? 100,
          offset: filters.offset ?? 0,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Supplier orders fetch failed: ${errorMessage}`, "supplier-orders");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Supplier Orders: Get stats
  app.get("/api/supplier-orders/stats", async (req, res) => {
    try {
      const stats = await storage.getSupplierOrderStats();
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Supplier Orders: Get single order with items
  app.get("/api/supplier-orders/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const order = await storage.getSupplierOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const items = await storage.getSupplierOrderItems(id);

      res.json({
        success: true,
        data: {
          ...order,
          items,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Supplier Orders: Update order
  app.patch("/api/supplier-orders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, expectedDeliveryDate, actualDeliveryDate, notes, trackingNumber, carrier } = req.body;

      const order = await storage.getSupplierOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const updateData: Partial<typeof order> = {};
      if (status !== undefined) updateData.status = status;
      if (expectedDeliveryDate !== undefined) {
        updateData.expectedDeliveryDate = expectedDeliveryDate ? new Date(expectedDeliveryDate) : null;
      }
      if (actualDeliveryDate !== undefined) {
        updateData.actualDeliveryDate = actualDeliveryDate ? new Date(actualDeliveryDate) : null;
      }
      if (notes !== undefined) updateData.notes = notes;
      if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
      if (carrier !== undefined) updateData.carrier = carrier;

      const updated = await storage.updateSupplierOrder(id, updateData);

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Supplier Orders: Toggle flag
  app.post("/api/supplier-orders/:id/flag", async (req, res) => {
    try {
      const { id } = req.params;
      const { isFlagged, flagReason } = req.body;

      const order = await storage.getSupplierOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const newFlagged = isFlagged !== undefined ? isFlagged : !order.isFlagged;
      const updated = await storage.updateSupplierOrder(id, {
        isFlagged: newFlagged,
        flagReason: newFlagged ? (flagReason || "Manually flagged") : null,
      });

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Supplier Orders: Delete ALL orders (for development/testing)
  app.delete("/api/supplier-orders", async (req, res) => {
    try {
      const count = await storage.deleteAllSupplierOrders();
      log(`Deleted all supplier orders (${count} orders removed)`, "supplier-orders");

      res.json({
        success: true,
        data: { deletedCount: count },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Supplier Orders: Delete order
  app.delete("/api/supplier-orders/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const order = await storage.getSupplierOrder(id);
      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const deleted = await storage.deleteSupplierOrder(id);

      if (deleted) {
        log(`Deleted supplier order: ${order.orderNumber || id} from ${order.supplierName}`, "supplier-orders");
      }

      res.json({
        success: true,
        data: { deleted },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Sync logs: Get recent sync logs
  app.get("/api/gmail/sync-logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const logs = await storage.getRecentSyncLogs(limit);

      res.json({
        success: true,
        data: logs,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Sync progress: Get current sync progress (for real-time status)
  app.get("/api/gmail/sync-progress", async (_req, res) => {
    try {
      const progress = emailSync.getSyncProgress();
      res.json({
        success: true,
        data: progress,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // ============================================================================
  // Supplier Tracking Settings
  // ============================================================================

  // Get settings
  app.get("/api/supplier-tracking/settings", async (req, res) => {
    try {
      const settings = await storage.getSupplierTrackingSettings();
      res.json({
        success: true,
        data: settings,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Update settings
  app.patch("/api/supplier-tracking/settings", async (req, res) => {
    try {
      const {
        inTransitThresholdDays,
        noTrackingThresholdDays,
        autoFlagOverdue,
        autoFlagCancelled,
        autoFlagNoTracking,
      } = req.body;

      const updates: Record<string, any> = {};
      if (typeof inTransitThresholdDays === "number") {
        updates.inTransitThresholdDays = inTransitThresholdDays;
      }
      if (typeof noTrackingThresholdDays === "number") {
        updates.noTrackingThresholdDays = noTrackingThresholdDays;
      }
      if (typeof autoFlagOverdue === "boolean") {
        updates.autoFlagOverdue = autoFlagOverdue;
      }
      if (typeof autoFlagCancelled === "boolean") {
        updates.autoFlagCancelled = autoFlagCancelled;
      }
      if (typeof autoFlagNoTracking === "boolean") {
        updates.autoFlagNoTracking = autoFlagNoTracking;
      }

      const settings = await storage.updateSupplierTrackingSettings(updates);
      res.json({
        success: true,
        data: settings,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // ============================================================================
  // Supplier Whitelist
  // ============================================================================

  // Get all whitelist entries
  app.get("/api/supplier-whitelist", async (req, res) => {
    try {
      const entries = await storage.getAllSupplierWhitelist();
      res.json({
        success: true,
        data: entries,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Create a whitelist entry
  app.post("/api/supplier-whitelist", async (req, res) => {
    try {
      const { name, emailPattern, notes } = req.body;

      if (!name || !emailPattern) {
        return res.status(400).json({
          success: false,
          error: "Name and email pattern are required",
        });
      }

      // Check if the domain is a courier - warn the user
      const testEmail = emailPattern.startsWith("@")
        ? `test${emailPattern}`
        : emailPattern;
      if (isCourierDomain(testEmail)) {
        return res.status(400).json({
          success: false,
          error: `"${name}" appears to be a courier/carrier (e.g., Royal Mail, DPD, FedEx), not a supplier. Couriers deliver packages but don't sell products. Emails from couriers will not create orders.`,
        });
      }

      const entry = await storage.createSupplierWhitelist({
        name,
        emailPattern,
        notes: notes || null,
        isActive: true,
      });

      log(`Created supplier whitelist entry: ${name} (${emailPattern})`, "whitelist");

      res.json({
        success: true,
        data: entry,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Update a whitelist entry
  app.patch("/api/supplier-whitelist/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, emailPattern, notes, isActive } = req.body;

      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (emailPattern !== undefined) updates.emailPattern = emailPattern;
      if (notes !== undefined) updates.notes = notes;
      if (isActive !== undefined) updates.isActive = isActive;

      const entry = await storage.updateSupplierWhitelist(id, updates);

      if (!entry) {
        return res.status(404).json({
          success: false,
          error: "Whitelist entry not found",
        });
      }

      log(`Updated supplier whitelist entry: ${entry.name}`, "whitelist");

      res.json({
        success: true,
        data: entry,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Delete a whitelist entry
  app.delete("/api/supplier-whitelist/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const entry = await storage.getSupplierWhitelist(id);

      if (!entry) {
        return res.status(404).json({
          success: false,
          error: "Whitelist entry not found",
        });
      }

      await storage.deleteSupplierWhitelist(id);
      log(`Deleted supplier whitelist entry: ${entry.name}`, "whitelist");

      res.json({
        success: true,
        message: "Whitelist entry deleted",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Import whitelist from CSV
  app.post("/api/supplier-whitelist/import", async (req, res) => {
    try {
      const { data } = req.body;

      if (!Array.isArray(data) || data.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No data provided for import",
        });
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const validated = csvSupplierWhitelistRowSchema.parse(row);
          await storage.createSupplierWhitelist({
            name: validated.name,
            emailPattern: validated.email_pattern,
            notes: validated.notes || null,
            isActive: true,
          });
          results.success++;
        } catch (error) {
          results.failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.errors.push(`Row ${i + 1}: ${errorMessage}`);
        }
      }

      log(`Imported ${results.success} supplier whitelist entries (${results.failed} failed)`, "whitelist");

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Download whitelist template CSV
  app.get("/api/supplier-whitelist/template", (req, res) => {
    const template = `name,email_pattern,notes
Amazon,@amazon.com,Amazon order notifications
Alibaba,@alibaba.com,Alibaba supplier emails
eBay,@ebay.com,eBay purchase notifications`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=supplier-whitelist-template.csv");
    res.send(template);
  });

  return httpServer;
}
