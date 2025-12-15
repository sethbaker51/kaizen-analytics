import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { log } from "./log";
import { csvSkuRowSchema, type InsertSkuItem } from "@shared/schema";

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

  return httpServer;
}
