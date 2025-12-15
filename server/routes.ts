import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { log } from "./log";

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

  return httpServer;
}
